(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const currencySymbols = { USD: "$", INR: "₹", EUR: "€", GBP: "£" };
  const displayRates = { USD: 1, INR: 83, EUR: 0.92, GBP: 0.79 };
  const categoryOffsets = {
    "Clean Energy & EV": [0.0645, 0.1024],
    "E-commerce & Q-Commerce": [-0.6865, -0.0334],
    Edtech: [0.0607, 0.2067],
    "Enterprise SaaS": [-0.1765, -0.0520],
    Fintech: [-0.4786, -0.0418],
    Healthtech: [0.1282, 0.1157],
    "Logistics & Supply Chain": [-0.6054, -0.2233],
    Agritech: [0, 0]
  };
  const investorOffsets = {
    "Corporate VC": [-1.0665, -0.5744],
    "Early-Stage VC": [-0.4223, -0.3414],
    "Growth VC": [-0.4395, -0.3098],
    Angel: [0, 0]
  };
  const sample = {
    name: "Northstar AI", category: "Enterprise SaaS", investor: "Early-Stage VC",
    valuation: 24, ltv: 6, rounds: 2, burn: 0.42, revenue: 10,
    funding: 3, experience: 18, margin: 12
  };
  const samplePortfolio = [
    { ...sample, stage: "Diligence" },
    { ...sample, name: "Verdant Grid", category: "Clean Energy & EV", investor: "Angel", valuation: 12, ltv: 4.1, rounds: 1, burn: 0.3, revenue: 4.2, funding: 2, experience: 14, margin: 8, stage: "Screening" },
    { ...sample, name: "Finloop", category: "Fintech", investor: "Growth VC", valuation: 18, ltv: 3.4, rounds: 2, burn: 0.62, revenue: 7.5, funding: 5, experience: 11, margin: 5, stage: "New" },
    { ...sample, name: "CarePath", category: "Healthtech", investor: "Early-Stage VC", valuation: 9, ltv: 5.2, rounds: 0, burn: 0.22, revenue: 2.7, funding: 1.5, experience: 9, margin: 15, stage: "IC ready" }
  ];
  const inputIds = ["valuation", "ltv-cac", "rounds", "burn", "revenue", "funding", "experience", "margin"];
  const inputLimits = {
    "valuation": [0, 10000], "ltv-cac": [0, 100], "rounds": [0, 30],
    "burn": [0, 1000], "revenue": [0, 10000], "funding": [0, 10000],
    "experience": [0, 80], "margin": [-100, 100]
  };
  let currentModel = null;
  let safeType = "pre";
  let votes = { strong: 0, conditional: 0, pass: 0 };
  let voteRecords = [];
  let stackRounds = [
    { name: "Series A", investment: 3, ownership: 18, multiple: 1, participation: "non" },
    { name: "Series B", investment: 4, ownership: 20, multiple: 1, participation: "non" }
  ];
  let stackDragging = null;
  const selectedDeals = new Set();
  let pitchObjectUrl = null;
  let pitchAnnotations = [];
  let termSummary = "";
  let toastTimer;
  let chatMode = "analyst";
  let chatBusy = false;
  const chatHistory = { analyst: [], helpdesk: [] };
  let importedDataset = false;
  let importedDatasetName = "";
  let importedStageMixInitialized = false;
  let activeDealId = null;

  function toast(message) {
    const target = $("#toast");
    target.textContent = message;
    target.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove("show"), 2800);
  }

  function displayMoney(value, decimals = 1) {
    const currency = $("#currency").value;
    const converted = value * displayRates[currency];
    const symbol = currencySymbols[currency];
    const amount = Math.abs(converted) >= 1000 ? (converted / 1000).toFixed(decimals) + "K" : converted.toFixed(decimals);
    return `${converted < 0 ? "−" : ""}${symbol}${amount}`;
  }

  function readInputs() {
    const values = {};
    for (const id of inputIds) {
      const field = $(`#${id}`);
      const value = field.value.trim() === "" ? NaN : Number(field.value);
      const [min, max] = inputLimits[id];
      if (!Number.isFinite(value) || value < min || value > max) {
        field.setAttribute("aria-invalid", "true");
        $("#validation-message").textContent = `${field.labels[0].textContent} must be a number from ${min} to ${max}.`;
        field.focus();
        return null;
      }
      field.removeAttribute("aria-invalid");
      values[id] = value;
    }
    $("#validation-message").textContent = "";
    return {
      valuation: values.valuation,
      ltv: values["ltv-cac"],
      rounds: values.rounds,
      burn: values.burn,
      revenue: values.revenue,
      funding: values.funding,
      experience: values.experience,
      margin: values.margin,
      category: $("#category").value,
      investor: $("#investor").value
    };
  }

  function calculate(inputs) {
    const category = categoryOffsets[inputs.category] || [0, 0];
    const investor = investorOffsets[inputs.investor] || [0, 0];
    const contributions = [
      ["Valuation", 0.0425 * inputs.valuation],
      ["LTV / CAC", 0.4170 * inputs.ltv],
      ["Funding rounds", -0.0634 * inputs.rounds],
      ["Monthly burn", -0.8281 * inputs.burn],
      ["Annual revenue", 0.0745 * inputs.revenue],
      ["Funding raised", -0.2765 * inputs.funding],
      ["Founder experience", 0.0850 * inputs.experience],
      ["Profit margin", -0.1207 * inputs.margin],
      ["Category", category[0]],
      ["Investor type", investor[0]]
    ];
    const logit = -1.3654 + contributions.reduce((total, row) => total + row[1], 0);
    const probability = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
    const roi = 1.9166 + 0.0237 * inputs.valuation + 0.2918 * inputs.ltv -
      0.0746 * inputs.rounds - 0.5420 * inputs.burn + 0.0303 * inputs.revenue -
      0.1191 * inputs.funding + 0.0456 * inputs.experience + 0.0021 * inputs.margin +
      category[1] + investor[1];
    return { probability, roi, logit, contributions, inputs };
  }

  function drawContributions(model) {
    const rows = model.contributions;
    const baseline = -1.3654;
    const steps = [];
    let running = baseline;
    rows.forEach(([name, value], index) => {
      const next = running + value;
      steps.push({ name, value, from: running, to: next, input: model.inputs });
      running = next;
    });
    const bounds = [baseline, running, ...steps.flatMap(({ from, to }) => [from, to])];
    const min = Math.min(0, ...bounds);
    const max = Math.max(0, ...bounds);
    const span = Math.max(0.001, max - min);
    const zero = (0 - min) / span * 100;
    const formatValue = (name, inputs) => ({
      Valuation: `$${inputs.valuation}M`, "LTV / CAC": `${inputs.ltv}×`,
      "Funding rounds": `${inputs.rounds}`, "Monthly burn": `$${inputs.burn}M`,
      "Annual revenue": `$${inputs.revenue}M`, "Funding raised": `$${inputs.funding}M`,
      "Founder experience": `${inputs.experience} years`, "Profit margin": `${inputs.margin}%`,
      Category: inputs.category, "Investor type": inputs.investor
    }[name] || "");
    const rowsHtml = steps.map(({ name, value, from, to }) => {
      const start = (Math.min(from, to) - min) / span * 100;
      const width = Math.max(0.8, Math.abs(value) / span * 100);
      const positive = value >= 0;
      return `<div class="waterfall-row" title="${escapeHtml(name)} ${escapeHtml(formatValue(name, model.inputs))}: ${positive ? "+" : ""}${value.toFixed(3)} logit contribution">
        <span class="contribution-name">${escapeHtml(name)}<small>${escapeHtml(formatValue(name, model.inputs))}</small></span>
        <span class="waterfall-track" style="--zero:${zero}%"><i class="waterfall-step ${positive ? "positive" : "negative"}" style="left:${start}%;width:${width}%"></i></span>
        <span class="contribution-value ${positive ? "pos" : "neg"}">${positive ? "+" : ""}${value.toFixed(3)}</span>
      </div>`;
    }).join("");
    const probability = Math.round(model.probability * 100);
    $("#contribution-chart").innerHTML = `<div class="waterfall-summary"><span>Starting logit<b>${baseline.toFixed(3)} intercept</b></span><span>Ending logit<b>${running.toFixed(3)} · ${probability}% modeled probability</b></span></div>
      <div class="waterfall-axis" aria-hidden="true"><span>NEGATIVE CONTRIBUTION</span><i style="--zero:${zero}%"></i><span>POSITIVE CONTRIBUTION</span></div>
      ${rowsHtml}
      <p class="micro-note">Each step is a supplied equation coefficient contribution to log-odds, not a causal effect or SHAP value. The logistic transform produces the final illustrative probability.</p>`;
  }

  function getRiskFlags(inputs) {
    const flags = [];
    if (inputs.ltv < 3) flags.push(["LTV / CAC below 3×", "high"]);
    else flags.push(["Healthy unit economics", "ok"]);
    if (inputs.burn > Math.max(inputs.revenue / 12, 0.35)) flags.push(["Burn exceeds revenue run-rate", ""]);
    if (inputs.rounds >= 4) flags.push(["Multiple prior rounds", ""]);
    if (inputs.margin < 0) flags.push(["Negative profit margin", "high"]);
    if (inputs.funding > inputs.revenue * 3 && inputs.revenue > 0) flags.push(["Capital efficiency to monitor", ""]);
    if (inputs.revenue === 0) flags.push(["No revenue reported", "high"]);
    return flags.length ? flags.slice(0, 4) : [["No threshold flags detected", "ok"]];
  }

  function renderModel(model) {
    currentModel = model;
    const percent = Math.round(model.probability * 100);
    $("#success-prob").textContent = `${percent}%`;
    if ($("#hero-score")) $("#hero-score").textContent = percent;
    if ($("#hero-score-bar")) $("#hero-score-bar").style.width = `${percent}%`;
    $("#probability-gauge").setAttribute("aria-label", `Success probability ${percent} percent`);
    $("#gauge-value").style.strokeDashoffset = `${229 * (1 - model.probability)}`;
    $("#projected-roi").innerHTML = `${model.roi.toFixed(1)}<span>×</span>`;
    $("#confidence-band").textContent = `${Math.max(0, percent - 10)}–${Math.min(100, percent + 10)}%`;
    $("#score-label").textContent = percent >= 65 ? "PROMISING" : percent >= 40 ? "WATCH" : "HIGH RISK";
    $("#score-label").className = `pill ${percent >= 65 ? "pill-positive" : percent >= 40 ? "pill-neutral" : "pill-risk"}`;
    const risks = getRiskFlags(model.inputs);
    $("#risk-count").textContent = `${risks.filter((r) => r[1] !== "ok").length} identified`;
    $("#risk-flags").innerHTML = risks.map(([text, type]) => `<span class="risk-tag ${type}">${text}</span>`).join("");
    drawContributions(model);
    updateWhatIf();
    updateMarket();
    renderBenchmarks();
    renderSensitivity();
    updateCounterproposal();
  }

  function recalculate() {
    const inputs = readInputs();
    if (!inputs) return;
    renderModel(calculate(inputs));
    syncActiveImportedDeal(inputs);
  }

  function syncActiveImportedDeal(inputs) {
    if (!importedDataset || !activeDealId) return;
    const deal = deals.find((item) => item.id === activeDealId);
    if (!deal) return;
    deal.model = { ...inputs, name: deal.name };
    deal.score = Math.round(calculate(deal.model).probability * 100);
    deal.amount = `${displayMoney(deal.model.valuation)}M`;
    deal.sector = `${deal.model.category} · ${pipelineStages[deal.stage]}`;
    renderPipeline();
    renderAllocation();
    renderBenchmarks();
    renderCorrelation();
  }

  function setFormData(data) {
    $("#startup-name").textContent = data.name || "Untitled opportunity";
    $("#category").value = categoryOffsets[data.category] ? data.category : "Agritech";
    $("#investor").value = investorOffsets[data.investor] ? data.investor : "Angel";
    const map = {
      valuation: data.valuation, "ltv-cac": data.ltv, rounds: data.rounds, burn: data.burn,
      revenue: data.revenue, funding: data.funding, experience: data.experience, margin: data.margin
    };
    Object.entries(map).forEach(([id, value]) => { if (value !== undefined && Number.isFinite(Number(value))) $(`#${id}`).value = value; });
    $("#burn-slider").value = Math.min(2.5, Math.max(0.05, Number($("#burn").value)));
    $("#revenue-slider").value = Math.min(30, Math.max(0, Number($("#revenue").value)));
    if (importedDataset) {
      const valuation = Math.max(0.1, Number(data.valuation) || 0.1);
      $("#safe-cap").value = Math.max(0.1, valuation / 3).toFixed(1);
      $("#safe-round").value = Math.max(0.1, valuation * 1.5).toFixed(1);
      $("#exit-value").value = Math.min(1000, Math.max(10, valuation * 3)).toFixed(0);
      $("#pitch-page").value = "1";
      $("#term-burn").value = Math.max(0.05, (Number(data.burn) || 0.05) * 0.8).toFixed(2);
      $("#term-valuation").value = Math.max(0.1, valuation * 0.85).toFixed(1);
      const estimatedOwnership = Math.min(80, Math.max(0, (Number(data.funding) || 0) / valuation * 100));
      stackRounds = [{
        name: "Imported funding (proxy)", investment: Math.max(0, Number(data.funding) || 0),
        ownership: estimatedOwnership, multiple: 1, participation: "non"
      }];
      renderPreferenceStack();
    }
    recalculate();
    $("#upload-status").textContent = `${data.name || "Startup"} loaded and screened.${importedDataset ? ` ${deals.length} imported companies drive the portfolio, pipeline, and comparisons.` : ""}`;
    if ($("#screening")) {
      if (importedDataset) renderAllocation();
      renderPipeline();
      updateSafe();
      updateWaterfall();
      syncIcScorecard(currentModel);
      if (importedDataset) {
        $("#waterfall-panel-note").textContent = "CSV does not include legal preference terms or a cap table. This view uses a clearly labeled proxy: one 1× non-participating preference for total funding raised and ownership estimated as funding ÷ valuation. Edit the stack to model a different assumption.";
      }
    }
  }

  function syncIcScorecard(model) {
    if (!model) return;
    const { inputs, probability } = model;
    const multiple = inputs.revenue > 0 ? inputs.valuation / inputs.revenue : 20;
    icRatings.splice(0, icRatings.length,
      Math.max(1, Math.min(5, Math.round(inputs.experience / 5))),
      Math.max(1, Math.min(5, Math.round(Math.log10(Math.max(1, inputs.revenue)) + 2))),
      Math.max(1, Math.min(5, Math.round(inputs.ltv))),
      Math.max(1, Math.min(5, Math.round((inputs.ltv + (inputs.margin > 0 ? 1 : 0)) / 2))),
      Math.max(1, Math.min(5, Math.round(6 - Math.min(5, multiple / 4)))),
      Math.max(1, Math.min(5, Math.round(probability * 5)))
    );
    votes = { strong: 0, conditional: 0, pass: 0 };
    voteRecords = [];
    $$(".risk-options input").forEach((input) => { input.checked = false; });
    if ($("#ic-pillar-inputs")) renderIcRadar();
    if ($("#ic-consensus-index")) updateVotes();
    const heading = $("#ic .vote-panel h3");
    if (heading) heading.textContent = `${$("#startup-name").textContent} · Illustrative scorecard`;
    const bestEstimate = $("#benchmark-bars");
    if (bestEstimate) renderBenchmarks();
    $("#vote-confirmation").textContent = `Scorecard defaults were refreshed for ${$("#startup-name").textContent} using transparent demo heuristics. Record new local votes for this company.`;
  }

  function updateWhatIf() {
    const base = currentModel || calculate({ ...sample, category: sample.category, investor: sample.investor });
    const burn = Number($("#burn-slider").value);
    const revenue = Number($("#revenue-slider").value);
    $("#burn-output").textContent = `$${burn.toFixed(2)}M`;
    $("#revenue-output").textContent = `$${revenue.toFixed(1)}M`;
    const scenario = calculate({ ...base.inputs, burn, revenue });
    const scenarioPercent = Math.round(scenario.probability * 100);
    const basePercent = Math.round(base.probability * 100);
    $("#whatif-prob").textContent = `${scenarioPercent}%`;
    const delta = scenarioPercent - basePercent;
    const deltaNode = $("#whatif-delta");
    deltaNode.textContent = `${delta > 0 ? "+" : ""}${delta} pts`;
    deltaNode.className = delta >= 0 ? "positive-text" : "negative-text";
    const scaled = Math.max(4, Math.min(96, scenarioPercent));
    $("#whatif-spark").style.background = `linear-gradient(155deg, transparent ${100 - scaled}%, var(--cyan) ${100 - scaled + 1}%, var(--cyan) ${100 - scaled + 5}%, transparent ${100 - scaled + 6}%)`;
  }

  function renderAllocation(resetImportedStageMix = false) {
    if (importedDataset && deals.length) {
      const colors = ["#52e0e8", "#6092ac", "#6e7bd0", "#40b98e", "#d9b870", "#bd7795", "#88ad75", "#9a85cc"];
      const totals = new Map();
      deals.forEach((deal) => {
        const category = deal.model.category || "Other";
        totals.set(category, (totals.get(category) || 0) + 1);
      });
      const items = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      let cursor = 0;
      const slices = items.map(([name, count], index) => {
        const start = cursor;
        cursor += count / deals.length * 100;
        return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
      });
      $(".donut-chart").style.background = `conic-gradient(${slices.join(",")})`;
      $(".donut-center strong").textContent = String(deals.length);
      $(".donut-chart").setAttribute("aria-label", `Imported portfolio with ${deals.length} companies across ${items.length} sectors`);
      $("#allocation-legend").innerHTML = items.map(([name, count], index) => {
        const share = count / deals.length * 100;
        return `<div class="allocation-item"><i style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(name)}</span><b>${share.toFixed(0)}%</b></div>`;
      }).join("");
      const totalValuation = deals.reduce((sum, deal) => sum + Math.max(0, Number(deal.model.valuation) || 0), 0);
      $("#deployment-total").textContent = `${displayMoney(totalValuation)}M`;
      $(".allocation-panel .panel-description").textContent = `${deals.length} imported companies across ${items.length} sectors. Sector shares and total valuation reflect the uploaded dataset.`;
      if (resetImportedStageMix || !importedStageMixInitialized) {
        const stageCounts = [0, 0, 0];
        deals.forEach((deal) => {
          const inferred = deal.model.rounds <= 1 ? 0 : deal.model.rounds <= 3 ? 1 : 2;
          stageCounts[inferred] += 1;
        });
        const stageTotal = stageCounts.reduce((sum, value) => sum + value, 0) || 1;
        ["seed", "seriesa", "followon"].forEach((key, index) => {
          $(`#${key}-weight`).value = Math.round(stageCounts[index] / stageTotal * 100);
        });
        importedStageMixInitialized = true;
      }
      $(".stage-allocation > .panel-kicker").textContent = "IMPORTED COMPANY MIX · STAGE INFERRED FROM FUNDING ROUNDS";
      $(".stage-allocation .micro-note").textContent = "Sector exposure and deployment value use imported companies. Stage mix is inferred from funding-round count (0–1 Seed, 2–3 Series A, 4+ follow-on); sliders and return assumptions remain adjustable and illustrative.";
      updateStageAllocation();
      return;
    }
    $(".donut-chart").style.background = "";
    $(".donut-center strong").textContent = "12";
    $(".donut-chart").setAttribute("aria-label", "Illustrative portfolio allocation visualization");
    $(".allocation-panel .panel-description").textContent = "An illustrative allocation across the current opportunity set.";
    $(".stage-allocation > .panel-kicker").textContent = "FUND DEPLOYMENT MIX";
    $(".stage-allocation .micro-note").textContent = "Stage weights are normalized for the chart. Return assumptions and macro shock are illustrative, not an optimized portfolio.";
    const items = [
      ["Enterprise SaaS", 32, "#52e0e8"], ["Fintech", 23, "#6092ac"],
      ["Healthtech", 20, "#6e7bd0"], ["Climate", 14, "#40b98e"], ["Other", 11, "#d9b870"]
    ];
    $("#allocation-legend").innerHTML = items.map(([name, value, color]) => `<div class="allocation-item"><i style="background:${color}"></i><span>${name}</span><b>${value}%</b></div>`).join("");
    $("#deployment-total").textContent = `${displayMoney(18.4)}M`;
    updateStageAllocation();
  }

  const pipelineStages = ["New", "Screening", "Diligence", "IC ready"];
  let deals = [
    { id: "northstar", name: "Northstar AI", sector: "Enterprise SaaS · Series A", score: 82, amount: "$24M", stage: 2, model: { ...sample } },
    { id: "verdant", name: "Verdant Grid", sector: "Clean Energy & EV · Seed", score: 76, amount: "$12M", stage: 1, model: { ...sample, name: "Verdant Grid", category: "Clean Energy & EV", valuation: 12, burn: .3, revenue: 4.2, ltv: 4.1, funding: 2, experience: 14 } },
    { id: "finloop", name: "Finloop", sector: "Fintech · Series A", score: 64, amount: "$18M", stage: 0, model: { ...sample, name: "Finloop", category: "Fintech", valuation: 18, burn: .62, revenue: 7.5, ltv: 3.4, funding: 5, experience: 11 } },
    { id: "carepath", name: "CarePath", sector: "Healthtech · Seed", score: 71, amount: "$9M", stage: 3, model: { ...sample, name: "CarePath", category: "Healthtech", valuation: 9, burn: .22, revenue: 2.7, ltv: 5.2, funding: 1.5, experience: 9 } }
  ];
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function renderPipeline() {
    if (importedDataset) {
      deals.forEach((deal) => { deal.sector = `${deal.model.category} · ${pipelineStages[deal.stage]}`; });
    }
    $("#pipeline-board").innerHTML = pipelineStages.map((stage, index) => {
      const cards = deals.filter((deal) => deal.stage === index).map((deal) => `<article class="deal-card" draggable="true" data-deal-id="${escapeHtml(deal.id)}" tabindex="0" aria-label="${escapeHtml(deal.name)}, ${stage} stage"><h4>${escapeHtml(deal.name)}</h4><p>${escapeHtml(deal.sector)}</p><div class="deal-meta"><span class="deal-score">◈ ${deal.score} score</span><select aria-label="Move ${escapeHtml(deal.name)} to stage">${pipelineStages.map((s, stageIndex) => `<option value="${stageIndex}" ${stageIndex === index ? "selected" : ""}>${s}</option>`).join("")}</select></div><button class="text-button screen-deal-button" type="button" data-screen-deal="${escapeHtml(deal.id)}">Screen this deal →</button></article>`).join("");
      return `<div class="pipeline-column" data-stage="${index}"><div class="column-head"><span class="column-title">${stage.toUpperCase()}</span><span class="column-count">${deals.filter((deal) => deal.stage === index).length}</span></div>${cards || `<p class="micro-note">Drop a deal here</p>`}</div>`;
    }).join("");
    $$(".deal-card").forEach((card) => {
      card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", card.dataset.dealId); event.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          const deal = deals.find((item) => item.id === card.dataset.dealId);
          if (deal) { deal.stage = Math.max(0, Math.min(3, deal.stage + (event.key === "ArrowRight" ? 1 : -1))); renderPipeline(); $(`[data-deal-id="${deal.id}"]`)?.focus(); }
        }
      });
      $("select", card).addEventListener("change", (event) => { const deal = deals.find((item) => item.id === card.dataset.dealId); if (deal) { deal.stage = Number(event.target.value); renderPipeline(); } });
    });
    $$(".pipeline-column").forEach((column) => {
      column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drag-over"); });
      column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
      column.addEventListener("drop", (event) => { event.preventDefault(); column.classList.remove("drag-over"); const deal = deals.find((item) => item.id === event.dataTransfer.getData("text/plain")); if (deal) { deal.stage = Number(column.dataset.stage); renderPipeline(); } });
    });
    $$("[data-screen-deal]").forEach((button) => button.addEventListener("click", () => {
      const deal = deals.find((item) => item.id === button.dataset.screenDeal);
      if (!deal) return;
      activeDealId = deal.id;
      selectedDeals.add(deal.id);
      while (selectedDeals.size > 4) selectedDeals.delete(selectedDeals.values().next().value);
      setFormData(deal.model);
      if (importedDataset) renderAllocation();
      renderPipeline();
      $("#screening").scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`${deal.name} is now the active screening.`);
    }));
    renderDealComparison();
  }

  function renderSensitivity() {
    const host = $("#sensitivity-heatmap");
    if (!host || !currentModel) return;
    const growthShocks = [-40, -20, 0, 20, 40];
    const burnShocks = [-30, -15, 0, 15, 30];
    const scenarios = [];
    growthShocks.forEach((growth) => burnShocks.forEach((burnChange) => {
      const inputs = { ...currentModel.inputs, revenue: Math.max(0, currentModel.inputs.revenue * (1 + growth / 100)), burn: Math.max(0, currentModel.inputs.burn * (1 + burnChange / 100)) };
      const model = calculate(inputs);
      scenarios.push({ growth, burnChange, model, runway: inputs.burn > 0 ? inputs.funding / inputs.burn * 12 : Infinity });
    }));
    const minRoi = Math.min(...scenarios.map(({ model }) => model.roi));
    const maxRoi = Math.max(...scenarios.map(({ model }) => model.roi));
    host.innerHTML = `<div class="heatmap-corner">REVENUE<br>GROWTH ↓ / BURN →</div>${burnShocks.map((shock) => `<div class="heatmap-axis">${shock > 0 ? "+" : ""}${shock}% burn</div>`).join("")}` +
      growthShocks.map((growth) => `<div class="heatmap-axis heatmap-row-label">${growth > 0 ? "+" : ""}${growth}% growth</div>` + burnShocks.map((burnChange) => {
        const scenario = scenarios.find((item) => item.growth === growth && item.burnChange === burnChange);
        const ratio = maxRoi === minRoi ? .5 : Math.max(0, Math.min(1, (scenario.model.roi - minRoi) / (maxRoi - minRoi)));
        const alpha = .12 + ratio * .5;
        const background = scenario.model.roi >= 0 ? `rgba(79,224,160,${alpha})` : `rgba(255,119,126,${alpha})`;
        return `<button type="button" role="gridcell" class="heat-cell" data-growth="${growth}" data-burn-shock="${burnChange}" style="--heat:${background}" aria-label="${growth}% revenue growth shock, ${burnChange}% burn shock: ${scenario.model.roi.toFixed(2)} times ROI, ${Math.round(scenario.model.probability * 100)} percent modeled survival, ${Number.isFinite(scenario.runway) ? scenario.runway.toFixed(0) : "unlimited"} months runway" title="${growth}% revenue / ${burnChange}% burn · ROI ${scenario.model.roi.toFixed(2)}× · survival ${Math.round(scenario.model.probability * 100)}% · runway ${Number.isFinite(scenario.runway) ? scenario.runway.toFixed(0) : "∞"} mo">${scenario.model.roi.toFixed(1)}×</button>`;
      }).join("")).join("");
    $$(".heat-cell", host).forEach((cell) => cell.addEventListener("click", () => {
      const scenario = scenarios.find((item) => item.growth === Number(cell.dataset.growth) && item.burnChange === Number(cell.dataset.burnShock));
      $$(".heat-cell", host).forEach((item) => item.classList.toggle("selected", item === cell));
      $("#sensitivity-detail").textContent = `${scenario.growth > 0 ? "+" : ""}${scenario.growth}% revenue-growth shock and ${scenario.burnChange > 0 ? "+" : ""}${scenario.burnChange}% burn → illustrative ROI ${scenario.model.roi.toFixed(2)}× · modeled survival odds ${Math.round(scenario.model.probability * 100)}% · estimated runway ${Number.isFinite(scenario.runway) ? scenario.runway.toFixed(1) + " months" : "not burn-limited"}.`;
    }));
  }

  function updateStageAllocation() {
    if (!$("#stage-pie")) return;
    const weights = ["seed", "seriesa", "followon"].map((key) => Number($(`#${key}-weight`).value));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const normalized = total ? weights.map((value) => value / total * 100) : [0, 0, 0];
    ["seed", "seriesa", "followon"].forEach((key, index) => { $(`#${key}-weight-output`).textContent = `${normalized[index].toFixed(0)}%`; });
    const failure = Number($("#macro-failure").value) / 100;
    $("#macro-failure-output").textContent = `${Math.round(failure * 100)}%`;
    const colors = ["#52e0e8", "#6e7bd0", "#40b98e"];
    const bounds = [normalized[0], normalized[0] + normalized[1], 100];
    $("#stage-pie").style.background = `conic-gradient(${colors[0]} 0 ${bounds[0]}%,${colors[1]} ${bounds[0]}% ${bounds[1]}%,${colors[2]} ${bounds[1]}% 100%)`;
    const stageMultiples = [2.4, 2.1, 1.8];
    const expectedReturn = 100 * normalized.reduce((sum, weight, index) => sum + weight / 100 * (stageMultiples[index] * (1 - failure) + .15 * failure), 0);
    $("#expected-fund-return").textContent = `${displayMoney(expectedReturn / 100)}× fund multiple`;
  }

  function renderPreferenceStack() {
    $("#preference-stack").innerHTML = stackRounds.map((round, index) => `<div class="stack-round" draggable="true" data-stack-index="${index}">
      <span class="stack-drag" aria-label="Drag to reorder">⠿</span><label>Round<input data-stack-field="name" value="${escapeHtml(round.name)}" maxlength="24" aria-label="Round name"></label>
      <label>Investment ($M)<input data-stack-field="investment" type="number" min="0" max="10000" step=".1" value="${round.investment}" aria-label="${escapeHtml(round.name)} investment"></label>
      <label>Ownership (%)<input data-stack-field="ownership" type="number" min="0" max="100" step=".5" value="${round.ownership}" aria-label="${escapeHtml(round.name)} ownership"></label>
      <label>Preference<input data-stack-field="multiple" type="number" min="0" max="10" step=".5" value="${round.multiple}" aria-label="${escapeHtml(round.name)} preference multiple"></label>
      <label>Terms<select data-stack-field="participation" aria-label="${escapeHtml(round.name)} participation"><option value="non" ${round.participation === "non" ? "selected" : ""}>Non-participating</option><option value="participating" ${round.participation === "participating" ? "selected" : ""}>Participating</option></select></label>
      <button class="stack-remove" type="button" data-remove-stack="${index}" aria-label="Remove ${escapeHtml(round.name)}">×</button></div>`).join("");
    $$(".stack-round").forEach((row) => {
      row.addEventListener("dragstart", (event) => { stackDragging = Number(row.dataset.stackIndex); event.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const target = Number(row.dataset.stackIndex);
        if (stackDragging !== null && stackDragging !== target) {
          const [item] = stackRounds.splice(stackDragging, 1);
          stackRounds.splice(target, 0, item);
          stackDragging = null;
          renderPreferenceStack();
          updateWaterfall();
        }
      });
    });
    $$("[data-stack-field]", $("#preference-stack")).forEach((input) => input.addEventListener("input", () => {
      const round = stackRounds[Number(input.closest(".stack-round").dataset.stackIndex)];
      const field = input.dataset.stackField;
      round[field] = field === "name" || field === "participation" ? input.value : Number(input.value);
      updateWaterfall();
    }));
    $$("[data-remove-stack]").forEach((button) => button.addEventListener("click", () => {
      if (stackRounds.length <= 1) return toast("Keep at least one preference round in the stack.");
      stackRounds.splice(Number(button.dataset.removeStack), 1);
      renderPreferenceStack();
      updateWaterfall();
    }));
  }

  function updateWaterfall() {
    const exit = Math.min(1000, Math.max(10, Number($("#exit-value").value) || 10));
    $("#exit-output").textContent = `${displayMoney(exit)}M`;
    $("#exit-slider").value = exit;
    const ownershipTotal = stackRounds.reduce((sum, round) => sum + Math.max(0, Number(round.ownership) || 0), 0);
    const optionPool = Math.min(100, Math.max(0, Number($("#option-pool").value) || 0));
    const commonOwnership = Math.max(0, 100 - ownershipTotal - optionPool);
    $("#common-ownership").textContent = `${commonOwnership.toFixed(1)}%`;
    $("#stack-warning").textContent = ownershipTotal + optionPool > 100 ? `Ownership and pool total ${(ownershipTotal + optionPool).toFixed(1)}%; common ownership is set to 0% until corrected.` : `Founders/common ${commonOwnership.toFixed(1)}% · option pool ${optionPool.toFixed(1)}%`;
    const rounds = stackRounds.map((round) => ({
      ...round, investment: Math.max(0, Number(round.investment) || 0),
      ownership: Math.max(0, Number(round.ownership) || 0) / 100,
      multiple: Math.max(0, Number(round.multiple) || 0)
    }));
    let available = exit;
    rounds.forEach((round) => {
      const floor = Math.min(available, round.investment * round.multiple);
      const asConvertedEstimate = exit * round.ownership;
      if (round.participation === "participating" || floor >= asConvertedEstimate) {
        round.preferencePayout = floor;
        round.converted = false;
        available -= floor;
      } else {
        round.preferencePayout = 0;
        round.converted = true;
      }
    });
    const convertedOwnership = rounds.filter((round) => round.converted).reduce((sum, round) => sum + round.ownership, 0);
    const participatingOwnership = rounds.filter((round) => round.participation === "participating").reduce((sum, round) => sum + round.ownership, 0);
    const shareDenominator = Math.max(.0001, commonOwnership / 100 + convertedOwnership + participatingOwnership);
    rounds.forEach((round) => {
      round.payout = round.preferencePayout + (round.converted || round.participation === "participating" ? available * round.ownership / shareDenominator : 0);
    });
    const commonPayout = available * (commonOwnership / 100) / shareDenominator;
    const poolPayout = available * (optionPool / 100) / shareDenominator;
    const payouts = rounds.map((round) => round.payout);
    const totalInvestor = payouts.reduce((sum, value) => sum + value, 0);
    const distribution = [...payouts, commonPayout, poolPayout];
    const colors = ["#52e0e8", "#6e7bd0", "#40b98e", "#d9b870", "#7094aa", "#bd7795"];
    $("#waterfall-result").innerHTML = `<div>VC preference stack<b>${displayMoney(totalInvestor)}M</b></div><div>Preference floors<b>${displayMoney(rounds.reduce((sum, row) => sum + row.investment * row.multiple, 0))}M</b></div><div>Founders + common<b>${displayMoney(commonPayout)}M</b></div>`;
    $("#waterfall-bar").innerHTML = distribution.map((value, index) => `<span class="${index >= rounds.length ? "other-segment" : "pref-segment"}" style="width:${Math.max(0, value / exit * 100)}%;background:${colors[index % colors.length]}" title="${escapeHtml(index < rounds.length ? rounds[index].name : index === rounds.length ? "Founders/common" : "Option pool")} ${displayMoney(value)}M"></span>`).join("");
    $("#waterfall-bar").setAttribute("aria-label", `VC proceeds ${totalInvestor.toFixed(1)} million, founders and common ${commonPayout.toFixed(1)} million, option pool ${poolPayout.toFixed(1)} million`);
    $("#waterfall-payouts").innerHTML = rounds.map((round) => `<div><span>${escapeHtml(round.name)}${round.converted ? " · converted" : " · preference"}</span><b>${displayMoney(round.payout)}M</b></div>`).join("") + `<div><span>Option pool</span><b>${displayMoney(poolPayout)}M</b></div>`;
  }

  const icPillars = ["Team quality", "Market size", "Moat / defensibility", "Unit economics", "Valuation", "Financial health"];
  const icRatings = [4, 4, 3, 4, 3, 4];
  function drawIcRadar() {
    const svg = $("#ic-radar");
    if (!svg) return;
    const cx = 120, cy = 112, radius = 77;
    const point = (index, scale) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      return `${(cx + Math.cos(angle) * radius * scale).toFixed(1)},${(cy + Math.sin(angle) * radius * scale).toFixed(1)}`;
    };
    const grid = [1, .75, .5, .25].map((scale) => `<polygon points="${icPillars.map((_, index) => point(index, scale)).join(" ")}" class="radar-grid"></polygon>`).join("");
    const axes = icPillars.map((name, index) => `<line x1="${cx}" y1="${cy}" x2="${point(index, 1).split(",")[0]}" y2="${point(index, 1).split(",")[1]}" class="radar-axis"></line><text x="${(cx + Math.cos(-Math.PI / 2 + index * Math.PI / 3) * (radius + 20)).toFixed(1)}" y="${(cy + Math.sin(-Math.PI / 2 + index * Math.PI / 3) * (radius + 20) + 3).toFixed(1)}" class="radar-label">${name.split(" ")[0]}</text>`).join("");
    svg.innerHTML = `<g>${grid}${axes}<polygon points="${icRatings.map((rating, index) => point(index, rating / 5)).join(" ")}" class="radar-shape"></polygon>${icRatings.map((rating, index) => `<circle cx="${point(index, rating / 5).split(",")[0]}" cy="${point(index, rating / 5).split(",")[1]}" r="3.5" class="radar-point"></circle>`).join("")}</g>`;
  }

  function renderIcRadar() {
    $("#ic-pillar-inputs").innerHTML = icPillars.map((pillar, index) => `<label>${pillar}<input type="range" min="1" max="5" step="1" value="${icRatings[index]}" data-pillar="${index}" aria-label="${pillar} rating"><output>${icRatings[index]}/5</output></label>`).join("");
    $$("[data-pillar]").forEach((slider) => slider.addEventListener("input", () => {
      icRatings[Number(slider.dataset.pillar)] = Number(slider.value);
      $("output", slider.parentElement).textContent = `${slider.value}/5`;
      drawIcRadar();
    }));
    drawIcRadar();
  }

  function updateVotes() {
    $("#yes-count").textContent = votes.strong;
    $("#abstain-count").textContent = votes.conditional;
    $("#no-count").textContent = votes.pass;
    const total = votes.strong + votes.conditional + votes.pass;
    const denominator = total || 1;
    $("#vote-bar").innerHTML = `<span class="yes" style="width:${votes.strong / denominator * 100}%"></span><span class="abstain" style="width:${votes.conditional / denominator * 100}%"></span><span class="no" style="width:${votes.pass / denominator * 100}%"></span>`;
    const label = $("#consensus-label");
    if (!total) { label.textContent = "AWAITING VOTES"; label.className = "pill pill-neutral"; $("#ic-consensus-index").textContent = "—"; }
    else {
      const index = Math.round((votes.strong * 100 + votes.conditional * 65) / total);
      $("#ic-consensus-index").textContent = `${index}/100`;
      if (index >= 70) { label.textContent = "BUY CONSENSUS"; label.className = "pill pill-positive"; }
      else if (index >= 45) { label.textContent = "CONDITIONAL"; label.className = "pill pill-neutral"; }
      else { label.textContent = "PASS CONSENSUS"; label.className = "pill pill-risk"; }
    }
  }

  function renderDealComparison() {
    if (!$("#deal-compare-picker")) return;
    $("#deal-compare-picker").innerHTML = deals.map((deal) => `<label class="compare-option"><input type="checkbox" data-compare-id="${escapeHtml(deal.id)}" ${selectedDeals.has(deal.id) ? "checked" : ""}><span><b>${escapeHtml(deal.name)}</b><small>${escapeHtml(deal.sector)}</small></span></label>`).join("");
    $$("[data-compare-id]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      if (checkbox.checked && selectedDeals.size >= 4) { checkbox.checked = false; return toast("Compare up to four opportunities at once."); }
      if (checkbox.checked) selectedDeals.add(checkbox.dataset.compareId);
      else selectedDeals.delete(checkbox.dataset.compareId);
      renderDealComparison();
    }));
    const chosen = deals.filter((deal) => selectedDeals.has(deal.id));
    $("#compare-count").textContent = `${chosen.length} SELECTED`;
    if (chosen.length < 2) { $("#deal-comparison").textContent = "Select at least two deals to build a comparison."; return; }
    const results = chosen.map((deal) => {
      const model = calculate(deal.model);
      return { deal, model, burn: deal.model.burn, valuation: deal.model.valuation, multiple: deal.model.revenue ? deal.model.valuation / deal.model.revenue : Infinity };
    });
    const lowestBurn = Math.min(...results.map((item) => item.burn));
    const highestMultiple = Math.max(...results.map((item) => item.multiple));
    $("#deal-comparison").innerHTML = `<div class="comparison-scroll"><table><thead><tr><th>Metric</th>${results.map(({ deal }) => `<th>${escapeHtml(deal.name)}</th>`).join("")}</tr></thead><tbody>
      <tr><th>Illustrative success odds</th>${results.map(({ model }) => `<td>${Math.round(model.probability * 100)}%</td>`).join("")}</tr>
      <tr><th>Illustrative ROI</th>${results.map(({ model }) => `<td>${model.roi.toFixed(2)}×</td>`).join("")}</tr>
      <tr><th>Monthly burn</th>${results.map((item) => `<td class="${item.burn === lowestBurn ? "compare-best" : ""}">${displayMoney(item.burn)}M${item.burn === lowestBurn ? " · lowest" : ""}</td>`).join("")}</tr>
      <tr><th>Valuation / revenue</th>${results.map((item) => `<td class="${item.multiple === highestMultiple ? "compare-risk" : ""}">${Number.isFinite(item.multiple) ? item.multiple.toFixed(1) + "×" : "n/a"}${item.multiple === highestMultiple ? " · highest" : ""}</td>`).join("")}</tr>
      <tr><th>Sector</th>${results.map(({ deal }) => `<td>${escapeHtml(deal.sector)}</td>`).join("")}</tr></tbody></table></div>
      <div class="comparison-bars">${results.map(({ deal, model }) => `<div><span>${escapeHtml(deal.name)}</span><i><b style="width:${Math.max(0, Math.min(100, model.roi / Math.max(1, ...results.map((item) => item.model.roi)) * 100))}%"></b></i><strong>${model.roi.toFixed(1)}×</strong></div>`).join("")}</div>
      <p class="micro-note">Lowest burn is highlighted in green; highest valuation/revenue multiple is flagged for review. Outputs use the supplied illustrative demo equations.</p>`;
  }

  function updateCounterproposal() {
    if (!$("#counterproposal-trigger") || !currentModel) return;
    const inputs = currentModel.inputs;
    const valuationMultiple = inputs.revenue > 0 ? inputs.valuation / inputs.revenue : Infinity;
    const flags = [];
    if (inputs.burn > 1.5) flags.push("monthly burn exceeds $1.5M");
    if (inputs.burn > Math.max(inputs.revenue / 12, .35)) flags.push("burn exceeds revenue run-rate");
    if (valuationMultiple > 12) flags.push("valuation/revenue exceeds 12×");
    $("#counterproposal-trigger").textContent = flags.length ? `Risk trigger: ${flags.join(" and ")}. Review and tune the counter-terms below.` : "No configured hard trigger; you can still draft counter-terms for negotiation.";
    $("#counterproposal-trigger").parentElement.classList.toggle("counterproposal-alert", flags.length > 0);
    if (flags.length) $("#counterproposal-drawer").classList.add("is-open");
    const targetBurn = Math.max(.05, Math.min(inputs.burn || .8, Number($("#term-burn").value) || .8));
    const targetValuation = Math.max(.1, Number($("#term-valuation").value) || inputs.valuation);
    $("#term-burn").value = targetBurn.toFixed(2);
    $("#term-valuation").value = targetValuation.toFixed(1);
    const adjustment = calculate({ ...inputs, burn: targetBurn, valuation: targetValuation });
    $("#counterproposal-result").innerHTML = `<div><span>Current illustrative success odds</span><b>${Math.round(currentModel.probability * 100)}%</b></div><div><span>With adjusted terms (model inputs only)</span><b>${Math.round(adjustment.probability * 100)}%</b></div><div><span>Adjusted illustrative ROI</span><b>${adjustment.roi.toFixed(2)}×</b></div>`;
    const tranche = Math.min(99, Math.max(1, Number($("#term-tranche-one").value) || 60));
    termSummary = `# Illustrative Counter-Proposal — ${$("#startup-name").textContent}\n\nNot legal advice. Draft for discussion only; all adjusted model outputs are illustrative and do not guarantee company outcomes.\n\n- Proposed pre-money valuation: $${targetValuation.toFixed(1)}M\n- Target monthly burn: $${targetBurn.toFixed(2)}M\n- Current illustrative modeled success odds: ${(currentModel.probability * 100).toFixed(1)}%\n- Adjusted illustrative modeled success odds: ${(adjustment.probability * 100).toFixed(1)}%\n- Adjusted illustrative ROI output: ${adjustment.roi.toFixed(2)}×\n${$("#term-tranches").checked ? `- Tranche 1: ${tranche}% of investment at close; remaining ${100 - tranche}% released after milestone: ${$("#term-milestone").value.trim() || "mutually agreed milestones"}.\n` : "- Funding released in a single tranche, subject to negotiated definitive documents.\n"}\n- Board seat: ${$("#term-board-seat")?.checked ? "Investor board seat requested." : "No investor board seat requested in this draft."}\n\nThis summary is a non-binding demo draft.`;
  }

  function saveBlob(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function savePitchAnnotation() {
    const note = $("#pitch-note").value.trim();
    if (!note) return toast("Add a source sentence or reviewer note first.");
    const page = Math.max(1, Number($("#pitch-page").value) || 1);
    const metricKey = $("#pitch-metric").value;
    const metric = $("#pitch-metric").selectedOptions[0].textContent;
    const inputs = currentModel?.inputs;
    const metricValues = inputs ? {
      burn: `$${inputs.burn}M/month`, valuation: `$${inputs.valuation}M`,
      revenue: `$${inputs.revenue}M/year`, ltv: `${inputs.ltv}×`, margin: `${inputs.margin}%`
    } : {};
    const inputKey = { burn: "burn", valuation: "valuation", revenue: "revenue", ltv: "ltv", margin: "margin" }[metricKey];
    const risk = inputs ? getRiskFlags(inputs).find(([flag]) => ({
      burn: /burn/i, valuation: /valuation/i, revenue: /revenue/i,
      ltv: /LTV/i, margin: /margin/i
    }[metricKey]).test(flag))?.[0] : null;
    pitchAnnotations.unshift({ metric, page, note, value: metricValues[metricKey] || "—", risk });
    $("#pitch-note").value = "";
    renderPitchAnnotations();
  }

  function jumpToPitchPage(page) {
    const viewer = $("#pitch-viewer object");
    if (!pitchObjectUrl || !viewer) return toast("Open a local PDF deck first; this note is saved for page " + page + ".");
    viewer.data = `${pitchObjectUrl}#page=${Math.max(1, Number(page) || 1)}&toolbar=1&navpanes=0`;
    $("#pitch-file-status").textContent = `Jumped to page ${page} · PDF remains local to this browser`;
  }

  function renderPitchAnnotations() {
    $("#pitch-annotation-list").innerHTML = pitchAnnotations.length ? pitchAnnotations.map((annotation, index) => `<article class="pitch-annotation"><span class="pill pill-neutral">${escapeHtml(annotation.metric)} · PAGE ${annotation.page}</span><p class="pitch-annotation-context">Current input: ${escapeHtml(annotation.value)}${annotation.risk ? ` · Flag: ${escapeHtml(annotation.risk)}` : ""}</p><p>${escapeHtml(annotation.note)}</p><button type="button" data-jump-annotation="${index}">Open page ${annotation.page}</button><button type="button" data-remove-annotation="${index}">Remove note</button></article>`).join("") : `<p class="micro-note">No source notes saved in this page session yet.</p>`;
    $$("[data-jump-annotation]").forEach((button) => button.addEventListener("click", () => jumpToPitchPage(pitchAnnotations[Number(button.dataset.jumpAnnotation)].page)));
    $$("[data-remove-annotation]").forEach((button) => button.addEventListener("click", () => {
      pitchAnnotations.splice(Number(button.dataset.removeAnnotation), 1);
      renderPitchAnnotations();
    }));
  }

  function playAudioBrief() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return toast("Speech synthesis is unavailable in this browser. Read the deal summary in the evaluation memo instead.");
    if (!currentModel) return toast("Load valid deal inputs before playing the brief.");
    const input = currentModel.inputs;
    const flags = getRiskFlags(input).map(([flag]) => flag).join(", ");
    const text = `DealCockpit illustrative executive brief for ${$("#startup-name").textContent}. The supplied demo model estimates ${Math.round(currentModel.probability * 100)} percent success odds and a ${currentModel.roi.toFixed(1)} times return output. Revenue is ${input.revenue} million dollars per year, monthly burn is ${input.burn} million dollars, and the valuation is ${input.valuation} million dollars. Review these risk flags: ${flags}. These are illustrative model outputs, not verified forecasts or investment advice.`;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function updateSafe() {
    const investment = Math.max(0, Number($("#safe-investment").value) || 0) / 1000;
    const cap = Math.max(0.001, Number($("#safe-cap").value) || 0.001);
    const discount = Math.min(100, Math.max(0, Number($("#safe-discount").value) || 0)) / 100;
    const round = Math.max(0.001, Number($("#safe-round").value) || 0.001);
    const effectivePrice = Math.min(cap, round * (1 - discount));
    const ownership = safeType === "post" ? investment / cap : investment / (effectivePrice + investment);
    const safeValuation = effectivePrice;
    $("#safe-result").innerHTML = `<span>Estimated ownership<b>${(ownership * 100).toFixed(2)}%</b></span><span>Conversion price basis<b>${safeValuation.toFixed(2)}M cap-equivalent</b></span><span>Applied term<b>${effectivePrice === cap ? "Valuation cap" : "Discount"}</b></span>`;
  }

  const marketPeers = {
    SaaS: { name: "Enterprise SaaS", low: 5, high: 12, median: 8.1 },
    Fintech: { name: "Fintech", low: 4, high: 10, median: 6.6 },
    Healthtech: { name: "Healthtech", low: 4.5, high: 11, median: 7.2 },
    Climate: { name: "Clean Energy & EV", low: 3, high: 9, median: 5.4 }
  };
  function updateMarket() {
    const categoryPeer = {
      "Enterprise SaaS": "SaaS", Fintech: "Fintech", Healthtech: "Healthtech",
      "Clean Energy & EV": "Climate"
    }[currentModel?.inputs.category];
    const selected = categoryPeer || $("#market-category").value;
    $("#market-category").value = selected;
    const peer = marketPeers[selected];
    const valuation = Number($("#valuation").value) || 0;
    const revenue = Number($("#revenue").value) || 0;
    const multiple = revenue > 0 ? valuation / revenue : 0;
    const max = 16;
    const rows = [
      { name: "Illustrative peer range", low: peer.low, high: peer.high, median: peer.median },
      { name: "This opportunity", low: multiple, high: multiple, median: multiple, deal: true }
    ];
    $("#market-chart").innerHTML = rows.map((row) => {
      const start = Math.min(98, Math.max(0, row.low / max * 100));
      const width = Math.max(row.deal ? 1.5 : 4, Math.min(100 - start, (row.high - row.low) / max * 100));
      return `<div class="market-row"><span class="market-label">${row.name}</span><div class="market-track"><i class="market-range ${row.deal ? "deal-range" : ""}" style="left:${start}%;width:${width}%"></i>${!row.deal ? `<i class="market-marker" style="left:${row.median / max * 100}%"></i>` : ""}</div><span class="market-value">${row.deal ? `${multiple.toFixed(1)}×` : `${row.low}–${row.high}×`}</span></div>`;
    }).join("");
    $("#deal-multiple-label").textContent = `${$("#startup-name").textContent}: ${revenue > 0 ? multiple.toFixed(1) : "—"}× ARR`;
  }

  function renderBenchmarks() {
    const score = Math.round((currentModel?.probability || 0) * 100);
    let metrics;
    if (importedDataset && deals.length) {
      const scores = deals.map((deal) => Math.round(calculate(deal.model).probability * 100)).sort((a, b) => a - b);
      const middle = Math.floor(scores.length / 2);
      const median = scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2;
      const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      metrics = [
        ["Active imported deal", score, true], ["Dataset average", Math.round(mean), false],
        ["Simple revenue rule", Math.min(78, Math.round(43 + Math.min(35, (Number($("#revenue").value) || 0) * 2))), false],
        ["Dataset median", Math.round(median), false]
      ];
      $(".benchmark-panel .panel-description").textContent = `Illustrative score comparisons across ${deals.length} imported startups; these are not validated predictive benchmarks.`;
    } else {
      metrics = [
        ["DealCockpit demo", score, true], ["Sector baseline", 52, false],
        ["Simple revenue rule", Math.min(78, Math.round(43 + Math.min(35, (Number($("#revenue").value) || 0) * 2))), false],
        ["Median screen", 48, false]
      ];
      $(".benchmark-panel .panel-description").textContent = "Illustrative comparison against simple screening baselines.";
    }
    $("#benchmark-bars").innerHTML = metrics.map(([name, value, current]) => `<div class="benchmark-row ${current ? "current" : ""}"><span>${name}</span><div class="benchmark-track"><i style="width:${value}%"></i></div><b>${value}</b></div>`).join("");
  }

  function renderCorrelation() {
    const labels = ["LTV/CAC", importedDataset ? "Valuation" : "Growth", "Margin", "Burn", importedDataset ? "Revenue" : "Founder"];
    let matrix = [
      [1, .42, .31, -.28, .12],
      [.42, 1, .53, -.21, .18],
      [.31, .53, 1, -.62, .08],
      [-.28, -.21, -.62, 1, -.04],
      [.12, .18, .08, -.04, 1]
    ];
    if (importedDataset) {
      const fields = [
        (deal) => deal.model.ltv,
        (deal) => deal.model.valuation,
        (deal) => deal.model.margin,
        (deal) => deal.model.burn,
        (deal) => deal.model.revenue
      ];
      matrix = fields.map((left, rowIndex) => fields.map((right, columnIndex) => {
        if (rowIndex === columnIndex) return 1;
        if (deals.length < 2) return NaN;
        const x = deals.map(left);
        const y = deals.map(right);
        const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
        const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
        const covariance = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0);
        const varianceX = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
        const varianceY = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
        return varianceX && varianceY ? Math.max(-1, Math.min(1, covariance / Math.sqrt(varianceX * varianceY))) : NaN;
      }));
      $(".correlation-panel .panel-description").textContent = deals.length > 1
        ? `Pearson correlations calculated from ${deals.length} imported companies. Correlation is descriptive and does not imply causation.`
        : "Import at least two companies with different values in each metric to calculate dataset correlations.";
    } else {
      $(".correlation-panel .panel-description").textContent = "Illustrative input correlations; not calculated from a real dataset.";
    }
    let html = `<span class="corr-label"></span>${labels.map((label) => `<span class="corr-label">${label}</span>`).join("")}`;
    matrix.forEach((row, rowIndex) => {
      html += `<span class="corr-label">${labels[rowIndex]}</span>`;
      row.forEach((value, columnIndex) => {
        if (!Number.isFinite(value)) {
          html += `<span class="corr-cell" title="${labels[rowIndex]} and ${labels[columnIndex]}: insufficient variation in imported data">—</span>`;
          return;
        }
        const alpha = .12 + Math.abs(value) * .62;
        const color = value >= 0 ? `rgba(82,224,232,${alpha})` : `rgba(255,119,126,${alpha})`;
        html += `<span class="corr-cell ${Math.abs(value) === 1 ? "diagonal" : ""}" title="${labels[rowIndex]} and ${labels[columnIndex]}: illustrative ${value.toFixed(2)}" style="${Math.abs(value) === 1 ? "" : `background:${color}`}">${value.toFixed(2)}</span>`;
      });
    });
    $("#correlation-matrix").innerHTML = html;
  }

  const glossary = [
    ["LTV / CAC", "Lifetime value divided by customer acquisition cost; a simple unit-economics efficiency ratio."],
    ["SAFE", "Simple Agreement for Future Equity; an instrument that may convert into equity in a later financing."],
    ["Liquidation preference", "A contractual priority that can affect distribution proceeds at an exit."],
    ["ARR multiple", "Valuation divided by annual recurring revenue; highly dependent on growth, margins, and market context."],
    ["Confidence band", "An illustrative display range around the demo score, not a statistically validated interval."]
  ];
  const commands = [
    { group: "PAGES", label: "Home", detail: "DealCockpit landing page", action: () => location.href = "index.html" },
    { group: "PAGES", label: "Features", detail: "Product overview and capabilities", action: () => location.href = "features.html" },
    { group: "PAGES", label: "Core engines", detail: "Interactive screening and capital tools", action: () => location.href = "engines.html#screening" },
    { group: "PAGES", label: "About", detail: "Meet the DealCockpit founders", action: () => location.href = "about.html" },
    { group: "ENGINES", label: "Deal screening", detail: "Jump to the screening dashboard", action: () => location.href = "engines.html#screening" },
    { group: "ENGINES", label: "Scenario lab", detail: "Burn and revenue what-if engine", action: () => location.href = "engines.html#whatif" },
    { group: "ENGINES", label: "Portfolio construction", detail: "Capital allocation visualization", action: () => location.href = "engines.html#portfolio" },
    { group: "ENGINES", label: "Sensitivity heat map", detail: "Stress revenue growth and burn together", action: () => location.href = "engines.html#sensitivity" },
    { group: "ENGINES", label: "Deal pipeline", detail: "Triage board", action: () => location.href = "engines.html#pipeline" },
    { group: "ENGINES", label: "Capital tools", detail: "SAFE and waterfall calculators", action: () => location.href = "engines.html#capital-tools" },
    { group: "ENGINES", label: "Counter-proposal builder", detail: "Turn risk triggers into editable deal terms", action: () => location.href = "engines.html#term-sheet" },
    { group: "ENGINES", label: "Compare deals", detail: "Side-by-side pipeline screening", action: () => location.href = "engines.html#compare-deals" },
    { group: "ENGINES", label: "Pitch deck review", detail: "Local PDF preview and speech summary", action: () => location.href = "engines.html#pitch-brief" },
    { group: "ENGINES", label: "Investment committee", detail: "Six-pillar scorecard and local demo voting", action: () => location.href = "engines.html#ic" },
    { group: "ACTIONS", label: "Load sample startup", detail: "Populate the screening model", action: openSampleDeal },
    { group: "ACTIONS", label: "Add startup to pipeline", detail: "Create a demo deal card", action: addDeal },
    { group: "ACTIONS", label: "Download evaluation memo", detail: "Save a Markdown deal brief", action: downloadMemo },
    ...glossary.map(([term, definition]) => ({ group: "GLOSSARY", label: term, detail: definition, action: () => toast(`${term}: ${definition}`) }))
  ];
  let activeCommandIndex = 0;
  function renderCommands(filter = "") {
    const filtered = commands.filter((item) => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(filter.toLowerCase()));
    $("#command-results").innerHTML = filtered.length ? filtered.map((item, index) => `<button type="button" class="command-item ${index === activeCommandIndex ? "selected" : ""}" data-command-label="${item.label}"><span>${item.label}</span><small>${item.group === "GLOSSARY" ? "Glossary" : item.detail}</small></button>`).join("") : `<div class="command-empty">No matching actions or glossary terms.</div>`;
    $$(".command-item").forEach((button) => button.addEventListener("click", () => {
      const item = filtered.find((entry) => entry.label === button.dataset.commandLabel);
      closeCommand();
      if (item) item.action();
    }));
    return filtered;
  }
  function openCommand() {
    $("#command-overlay").hidden = false;
    $("#command-input").value = "";
    activeCommandIndex = 0;
    renderCommands();
    $("#command-input").focus();
  }
  function closeCommand() { $("#command-overlay").hidden = true; $("#open-shortcuts").focus(); }

  function openSampleDeal() {
    if ($("#screening")) {
      setFormData(sample);
      toast("Northstar AI sample loaded.");
      return;
    }
    location.href = "engines.html#screening";
  }

  function addDeal() {
    if (!$("#pipeline-board")) {
      location.href = "engines.html#pipeline";
      return;
    }
    const name = window.prompt("Startup name:", "New venture");
    if (!name || !name.trim()) return;
    const modelInputs = currentModel ? { ...currentModel.inputs } : { ...sample };
    deals.unshift({ id: `deal-${Date.now()}`, name: name.trim().slice(0, 50), sector: `${modelInputs.category} · Pre-seed`, score: Math.round(currentModel?.probability * 100 || 50), amount: "TBD", stage: 0, model: { ...modelInputs, name: name.trim() } });
    renderPipeline();
    toast(`${name.trim()} added to your pipeline.`);
  }

  function downloadMemo() {
    if (!$("#screening")) {
      location.href = "engines.html#screening";
      return;
    }
    if (!currentModel) return toast("Load valid deal inputs before exporting.");
    const { inputs, probability, roi, contributions } = currentModel;
    const date = new Date().toLocaleDateString();
    const risks = getRiskFlags(inputs).map((item) => `- ${item[0]}`).join("\n");
    const topDrivers = contributions.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([name, value]) => `- ${name}: ${value > 0 ? "+" : ""}${value.toFixed(3)} logit contribution`).join("\n");
    const content = `# Illustrative Deal Evaluation Memo\n\n**Company:** ${$("#startup-name").textContent}\n**Date:** ${date}\n**Category:** ${inputs.category} · **Investor type:** ${inputs.investor}\n\n> Demo model output for discussion only. Not investment advice, a recommendation, validated backtesting, or a forecast. Confidence band and benchmarks are illustrative.\n\n## Screening snapshot\n- Success probability: ${(probability * 100).toFixed(1)}% (illustrative band ${(Math.max(0, probability * 100 - 10)).toFixed(0)}–${Math.min(100, probability * 100 + 10).toFixed(0)}%)\n- Projected ROI: ${roi.toFixed(2)}× (illustrative model output)\n- Valuation: $${inputs.valuation}M; LTV/CAC: ${inputs.ltv}; funding rounds: ${inputs.rounds}\n- Monthly burn: $${inputs.burn}M; annual revenue: $${inputs.revenue}M; funding raised: $${inputs.funding}M\n- Founder experience: ${inputs.experience} years; profit margin: ${inputs.margin}%\n\n## Primary model drivers\n${topDrivers}\n\n## Risk flags\n${risks}\n\n## Model note\nUses the supplied illustrative logistic success equation and linear ROI equation with category and investor offsets. This browser demo does not train models or calculate SHAP values.\n`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${$("#startup-name").textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-evaluation-memo.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Evaluation memo downloaded.");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], value = "", quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(value.trim()); value = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(value.trim());
        if (row.some((cell) => cell)) rows.push(row);
        row = []; value = "";
      } else value += char;
    }
    row.push(value.trim());
    if (row.some((cell) => cell)) rows.push(row);
    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    if (rows.length < 2) throw new Error("CSV needs a header row and at least one startup row.");
    const normalize = (header) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
    const headers = rows[0].map(normalize);
    const aliases = {
      name: ["name", "startup", "company", "startupname", "companyname"],
      category: ["category", "sector", "industry"],
      investor: ["investor", "investortype"],
      stage: ["stage", "pipelinestage", "dealstage"],
      valuation: ["valuation", "valuationm", "valuationusd", "valuationusdm", "valuationusdmm", "companyvaluation"],
      ltv: ["ltvcac", "ltvtocac", "ltvcacratio"],
      rounds: ["rounds", "fundingrounds"],
      burn: ["burn", "monthlyburn", "monthlyburnm", "monthlyburnusdm"],
      revenue: ["revenue", "annualrevenue", "annualrevenuem", "annualrevenueusdm", "arr"],
      funding: ["funding", "fundingraised", "fundingraisedm", "fundingraisedusdm", "totalfunding", "totalfundingm"],
      experience: ["experience", "founderexperience", "founderexperienceyears"],
      margin: ["margin", "profitmargin", "profitmarginpercent", "profitmarginpct"]
    };
    const columns = {};
    Object.entries(aliases).forEach(([key, options]) => {
      columns[key] = headers.findIndex((header) => options.includes(normalize(header)));
    });
    const formMap = { valuation: "valuation", ltv: "ltv-cac", rounds: "rounds", burn: "burn", revenue: "revenue", funding: "funding", experience: "experience", margin: "margin" };
    const requiredFields = Object.keys(formMap);
    const missing = requiredFields.filter((key) => columns[key] < 0);
    if (missing.length) {
      throw new Error(`CSV is missing required model columns: ${missing.join(", ")}. Include valuation, ltv_cac, rounds, burn, revenue, funding, experience, and margin.`);
    }
    const categories = Object.keys(categoryOffsets);
    const investors = Object.keys(investorOffsets);
    const records = rows.slice(1).map((cells, index) => {
      const line = index + 2;
      if (cells.length !== headers.length) throw new Error(`CSV row ${line} has ${cells.length} values; expected ${headers.length}.`);
      const record = {};
      Object.entries(columns).forEach(([key, column]) => {
        if (column < 0 || cells[column] === "") return;
        record[key] = key === "name" || key === "category" || key === "investor" || key === "stage"
          ? cells[column] : Number(cells[column]);
      });
      if (requiredFields.some((key) => record[key] === undefined)) {
        throw new Error(`CSV row ${line} is missing a required model value. Each startup needs all eight model inputs.`);
      }
      if (Object.entries(formMap).some(([key, id]) => {
        const value = record[key];
        const [minimum, maximum] = inputLimits[id];
        return !Number.isFinite(value) || value < minimum || value > maximum;
      })) {
        const invalid = Object.entries(formMap).find(([key, id]) => {
          const [minimum, maximum] = inputLimits[id];
          return !Number.isFinite(record[key]) || record[key] < minimum || record[key] > maximum;
        });
        throw new Error(`CSV row ${line}: ${invalid[0]} must be a number from ${inputLimits[invalid[1]][0]} to ${inputLimits[invalid[1]][1]}.`);
      }
      if (record.category) {
        const match = categories.find((item) => item.toLowerCase() === record.category.toLowerCase());
        if (!match) throw new Error(`CSV row ${line}: unknown category "${record.category}". Use a category shown in the screening selector.`);
        record.category = match;
      }
      if (record.investor) {
        const match = investors.find((item) => item.toLowerCase() === record.investor.toLowerCase());
        if (!match) throw new Error(`CSV row ${line}: unknown investor type "${record.investor}". Use Angel, Early-Stage VC, Growth VC, or Corporate VC.`);
        record.investor = match;
      }
      record.name = (record.name || `Startup ${index + 1}`).slice(0, 50);
      record.category = record.category || sample.category;
      record.investor = record.investor || sample.investor;
      record.stage = record.stage || "";
      record._csvLine = line;
      return { ...sample, ...record };
    });
    if (records.length > 200) throw new Error("Import up to 200 startups per CSV so the dashboards remain responsive.");
    return records;
  }

  async function loadCsv(file) {
    if (!file || (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv")) return toast("Choose a CSV file to load startup data.");
    try {
      const records = parseCsv(await file.text());
      if (!$("#screening")) {
        try {
          sessionStorage.setItem("dealcockpit-pending-deal", JSON.stringify({ records, filename: file.name }));
          location.href = "engines.html#screening";
        } catch {
          throw new Error("Browser storage is unavailable, so this CSV cannot be passed to the engines page. Open Core engines and import the CSV there.");
        }
        return;
      }
      loadDataset(records, file.name);
    } catch (error) {
      $("#upload-status").textContent = error.message;
      toast(error.message);
    }
  }

  function pipelineStageForRecord(record) {
    const value = String(record.stage || "").trim().toLowerCase().replace(/[_-]+/g, " ");
    const explicitStages = {
      new: 0, "pre seed": 0, seed: 0, screening: 1, diligence: 2,
      "series a": 2, "series b": 3, "follow on": 3, growth: 3, "ic ready": 3, ic: 3
    };
    if (Object.prototype.hasOwnProperty.call(explicitStages, value)) return explicitStages[value];
    if (record.rounds <= 0) return 0;
    if (record.rounds <= 1) return 1;
    if (record.rounds <= 3) return 2;
    return 3;
  }

  function loadDataset(records, filename = "Imported CSV") {
    importedDataset = true;
    importedDatasetName = filename;
    importedStageMixInitialized = false;
    deals = records.map((record, index) => {
      const model = {
        ...record,
        category: categoryOffsets[record.category] ? record.category : sample.category,
        investor: investorOffsets[record.investor] ? record.investor : sample.investor
      };
      const score = Math.round(calculate(model).probability * 100);
      return {
        id: `csv-${index}-${Date.now()}`,
        name: record.name,
        sector: `${model.category} · ${pipelineStages[pipelineStageForRecord(record)]}`,
        score,
        amount: displayMoney(model.valuation) + "M",
        stage: pipelineStageForRecord(record),
        model
      };
    });
    selectedDeals.clear();
    deals.slice(0, 4).forEach((deal) => selectedDeals.add(deal.id));
    activeDealId = deals[0].id;
    votes = { strong: 0, conditional: 0, pass: 0 };
    voteRecords = [];
    setFormData(deals[0].model);
    renderAllocation();
    renderPipeline();
    updateMarket();
    renderBenchmarks();
    renderCorrelation();
    $("#upload-status").textContent = `${records.length} startup${records.length === 1 ? "" : "s"} loaded from ${filename}. Imported data now drives screening, the pipeline, comparison, sector exposure, and AI context.`;
    toast(`${records.length} startup${records.length === 1 ? "" : "s"} imported. Dashboards updated.`);
  }

  function loadSamplePortfolio() {
    loadDataset(samplePortfolio, "DealCockpit sample portfolio");
  }

  function addChatMessage(text, className = "assistant-msg") {
    const message = document.createElement("div");
    message.className = `chat-msg ${className}`;
    message.textContent = text;
    $("#chat-messages").append(message);
    $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
    return message;
  }

  function assistantWelcome(mode) {
    return mode === "helpdesk"
      ? "Welcome to the DealCockpit help desk. Tell me what you’re trying to do or what went wrong; I can help with the product and general questions."
      : "Hi! Ask me about this deal, venture investing, financial modeling, or another topic. I’ll explain assumptions and call out uncertainty.";
  }

  function getDealContext() {
    if (!currentModel) return null;
    const { inputs, probability, roi, contributions } = currentModel;
    const burn = Number($("#burn-slider")?.value || inputs.burn);
    const revenue = Number($("#revenue-slider")?.value || inputs.revenue);
    const scenario = calculate({ ...inputs, burn, revenue });
    const weights = ["seed", "seriesa", "followon"].map((key) => Number($(`#${key}-weight`)?.value || 0));
    const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
    const failureShock = Number($("#macro-failure")?.value || 0);
    const exitValue = Number($("#exit-value")?.value || 0);
    const comparison = deals.filter((deal) => selectedDeals.has(deal.id)).map((deal) => {
      const result = calculate(deal.model);
      return {
        company: deal.name, sector: deal.sector, pipelineStage: pipelineStages[deal.stage],
        valuationMillion: deal.model.valuation, monthlyBurnMillion: deal.model.burn,
        annualRevenueMillion: deal.model.revenue,
        illustrativeSuccessProbabilityPercent: Math.round(result.probability * 100),
        illustrativeRoiMultiple: Number(result.roi.toFixed(2))
      };
    });
    const sectorCounts = new Map();
    deals.forEach((deal) => sectorCounts.set(deal.model.category, (sectorCounts.get(deal.model.category) || 0) + 1));
    const selectedStress = $(".heat-cell.selected");
    const selectedRiskJustifications = $$(".risk-options input:checked").map((input) => input.value);
    return {
      source: "DealCockpit browser dashboard",
      company: $("#startup-name").textContent,
      category: inputs.category,
      investorType: inputs.investor,
      importedDataset: importedDataset ? {
        filename: importedDatasetName,
        companyCount: deals.length,
        activeCompany: deals.find((deal) => deal.id === activeDealId)?.name || $("#startup-name").textContent
      } : null,
      inputs: {
        valuationMillion: inputs.valuation, ltvCac: inputs.ltv, fundingRounds: inputs.rounds,
        monthlyBurnMillion: inputs.burn, annualRevenueMillion: inputs.revenue,
        fundingRaisedMillion: inputs.funding, founderExperienceYears: inputs.experience,
        profitMarginPercent: inputs.margin
      },
      illustrativeSuccessProbabilityPercent: Math.round(probability * 100),
      illustrativeRoiMultiple: Number(roi.toFixed(2)),
      heuristicRiskFlags: getRiskFlags(inputs).map(([name]) => name),
      largestLogitContributions: contributions.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5).map(([feature, logitContribution]) => ({ feature, logitContribution: Number(logitContribution.toFixed(3)) })),
      dashboards: {
        whatIfScenario: {
          monthlyBurnMillion: burn, annualRevenueMillion: revenue,
          illustrativeSuccessProbabilityPercent: Math.round(scenario.probability * 100),
          illustrativeRoiMultiple: Number(scenario.roi.toFixed(2))
        },
        capitalAllocation: {
          importedCompanyCount: importedDataset ? deals.length : null,
          sectorExposurePercent: Object.fromEntries([...sectorCounts.entries()].map(([sector, count]) => [
            sector, Number((count / Math.max(1, deals.length) * 100).toFixed(1))
          ])),
          totalImportedValuationMillion: importedDataset ? Number(deals.reduce((sum, deal) => sum + (Number(deal.model.valuation) || 0), 0).toFixed(2)) : null,
          normalizedStageWeightsPercent: {
            seed: Number((weights[0] / weightTotal * 100).toFixed(1)),
            seriesA: Number((weights[1] / weightTotal * 100).toFixed(1)),
            followOnReserve: Number((weights[2] / weightTotal * 100).toFixed(1))
          },
          macroFailureRateShockPercent: failureShock,
          illustrativeExpectedFundReturnMultiple: $("#expected-fund-return")?.textContent || ""
        },
        dealPipeline: deals.slice(0, 12).map((deal) => ({
          company: deal.name, sector: deal.sector, stage: pipelineStages[deal.stage],
          score: deal.score, valuationMillion: deal.model.valuation, monthlyBurnMillion: deal.model.burn,
          annualRevenueMillion: deal.model.revenue
        })),
        sensitivity: selectedStress ? {
          revenueGrowthShockPercent: Number(selectedStress.dataset.growth),
          burnShockPercent: Number(selectedStress.dataset.burnShock),
          selectedCell: $("#sensitivity-detail")?.textContent || ""
        } : "No sensitivity cell selected.",
        capTable: {
          exitValueMillion: exitValue,
          optionPoolPercent: Number($("#option-pool")?.value || 0),
          preferenceRounds: stackRounds.map(({ name, investment, ownership, multiple, participation }) => ({
            name, investmentMillion: investment, ownershipPercent: ownership,
            preferenceMultiple: multiple, participation
          })),
          illustrativePayouts: $("#waterfall-payouts")?.innerText || ""
        },
        safeCalculator: {
          type: safeType === "post" ? "post-money" : "pre-money",
          investmentThousand: Number($("#safe-investment")?.value || 0),
          valuationCapMillion: Number($("#safe-cap")?.value || 0),
          discountPercent: Number($("#safe-discount")?.value || 0),
          nextRoundPreMoneyMillion: Number($("#safe-round")?.value || 0),
          illustrativeOutput: $("#safe-result")?.innerText || ""
        },
        counterProposal: {
          targetBurnMillion: Number($("#term-burn")?.value || 0),
          targetValuationMillion: Number($("#term-valuation")?.value || 0),
          milestoneTranches: Boolean($("#term-tranches")?.checked),
          boardSeatRequested: Boolean($("#term-board-seat")?.checked),
          currentIllustrativeTerms: termSummary.slice(0, 1600)
        },
        dealComparison: comparison,
        marketContext: {
          peerSet: $("#market-category")?.selectedOptions[0]?.textContent || "",
          impliedArrMultiple: inputs.revenue > 0 ? Number((inputs.valuation / inputs.revenue).toFixed(2)) : null,
          benchmark: $("#deal-multiple-label")?.textContent || ""
        },
        investmentCommittee: {
          pillars: icPillars.map((pillar, index) => ({ pillar, ratingOutOfFive: icRatings[index] })),
          localVoteCounts: { ...votes }, consensusIndex: $("#ic-consensus-index")?.textContent || "—",
          selectedRiskJustifications,
          recentLocalVotes: voteRecords.slice(-8).map(({ vote, risks, ratings }) => ({ vote, risks, ratings }))
        },
        pitchDeckReview: {
          localPdfOpen: Boolean(pitchObjectUrl),
          annotations: pitchAnnotations.slice(0, 8).map(({ metric, page, note, value, risk }) => ({
            metric, page, note: note.slice(0, 300), currentInputValue: value, matchedRiskFlag: risk || null
          }))
        }
      },
      disclaimer: "All values are illustrative demo calculations, not investment advice or validated predictions."
    };
  }

  function wireDashboardAssistantLinks() {
    const labels = {
      screening: "deal screening", engines: "scenario lab and portfolio allocation",
      sensitivity: "two-variable sensitivity stress grid", pipeline: "deal pipeline",
      "capital-tools": "cap table, liquidation waterfall, and SAFE calculator",
      "term-sheet": "counter-proposal builder", "compare-deals": "side-by-side deal comparison",
      "pitch-brief": "pitch deck notes and executive brief", market: "ARR market comparisons",
      ic: "investment committee scorecard and votes"
    };
    Object.entries(labels).forEach(([sectionId, label]) => {
      const section = $(`#${sectionId}`);
      const heading = $(".section-heading", section);
      if (!heading || $("[data-ai-dashboard]", heading)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-outline dashboard-ai-link";
      button.dataset.aiDashboard = label;
      button.textContent = "Ask AI about this";
      button.setAttribute("aria-label", `Ask the AI analyst about ${label}`);
      button.addEventListener("click", () => {
        updateAssistantMode("analyst");
        const assistant = $(".chat-panel");
        const input = $("#chat-input");
        input.value = `Help me interpret the ${label} dashboard for ${$("#startup-name").textContent}. Use its live data${importedDataset ? ` from the ${deals.length}-company uploaded dataset` : ""}, explain important trade-offs and uncertainties, and suggest useful follow-up questions.`;
        assistant.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus({ preventScroll: true });
      });
      heading.append(button);
    });
  }

  function updateAssistantMode(mode, clear = true) {
    chatMode = mode === "helpdesk" ? "helpdesk" : "analyst";
    $$(".assistant-tab").forEach((tab) => {
      const active = tab.dataset.chatMode === chatMode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    $("#assistant-title").textContent = chatMode === "helpdesk" ? "Help desk" : "Ask the analyst";
    $("#assistant-description").textContent = chatMode === "helpdesk"
      ? "Get help using DealCockpit, troubleshooting the demo, or ask a general question."
      : "Ask general questions or explore this deal. Current screening, scenario, pipeline, capital, market, pitch-review, and IC dashboard data is included when available.";
    $("#chat-input").placeholder = chatMode === "helpdesk" ? "How can we help?" : "Ask anything…";
    if (clear) {
      chatHistory[chatMode] = [];
      $("#chat-messages").replaceChildren();
      addChatMessage(assistantWelcome(chatMode));
    }
    const suggestions = chatMode === "helpdesk"
      ? ["How do I load a CSV?", "The page is not opening", "How do I change the theme?"]
      : ["Explain this deal’s score", "How does a SAFE work?", "Help me use DealCockpit"];
    $$(".chat-suggestions button").forEach((button, index) => { button.textContent = suggestions[index]; });
  }

  function localSupportAnswer(question) {
    const text = question.toLowerCase();
    if (/csv|upload|import|spreadsheet/.test(text)) return "Open Core engines. Use “Bring your own deal data” to browse for or drop a .csv file. The first data row is imported; use headers such as name, category, investor, valuation, ltv_cac, rounds, burn, revenue, funding, experience, and margin.";
    if (/page|website|open|localhost|server|start|run/.test(text)) return "Start the local PowerShell server from the project folder with `powershell -ExecutionPolicy Bypass -File .\\server.ps1`, then open http://localhost:8000. If you only need the static site, use `python -m http.server 8000` (Python must be installed); the AI needs server.ps1 and an API key.";
    if (/theme|light|dark|appearance/.test(text)) return "Use the sun/moon button in the top-right of any page. Your theme preference is saved in this browser.";
    if (/currency|exchange|rate|money/.test(text)) return "The currency selector changes a few displayed summary values using fixed illustrative rates. It is not live foreign-exchange data.";
    if (/command|shortcut|ctrl|cmd|search/.test(text)) return "Press Ctrl+K on Windows or Cmd+K on Mac to search page navigation, actions, and glossary terms.";
    if (/safe|calculator|ownership|waterfall|liquidation/.test(text)) return "Open Core engines → Capital tools. The SAFE estimator and simplified liquidation waterfall recalculate as you change their inputs. They are educational examples, not legal or tax advice.";
    if (/screen|probability|score|model|roi|risk/.test(text)) return "Open Core engines → Deal screening. Update the inputs to recalculate the supplied illustrative equations. The confidence band and threshold flags are heuristic, not validated model performance.";
    if (/export|memo|download/.test(text)) return "On Core engines, use “Download evaluation memo” to save the current screening snapshot as a Markdown file.";
    return null;
  }

  async function sendChat(text) {
    const trimmed = text.trim();
    if (!trimmed || chatBusy) return;
    const input = $("#chat-input");
    const send = $("#chat-send");
    const history = chatHistory[chatMode];
    history.push({ role: "user", content: trimmed });
    addChatMessage(trimmed, "user-msg");
    input.value = "";
    chatBusy = true;
    send.disabled = true;
    send.setAttribute("aria-label", "Assistant is responding");
    input.disabled = true;
    const typing = addChatMessage("Thinking…", "typing-msg");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: chatMode, messages: history.slice(-12), context: chatMode === "analyst" ? getDealContext() : null })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 && payload.code === "AI_NOT_CONFIGURED") {
          const localAnswer = chatMode === "helpdesk" ? localSupportAnswer(trimmed) : null;
          if (localAnswer) {
            const fallback = `${localAnswer}\n\nThe general AI assistant is not connected yet. Configure an API key for open-ended answers (see README).`;
            typing.remove();
            addChatMessage(fallback);
            history.push({ role: "assistant", content: fallback });
            return;
          }
        }
        throw new Error(payload.error || `The assistant returned an error (${response.status}).`);
      }
      if (typeof payload.answer !== "string" || !payload.answer.trim()) throw new Error("The assistant returned an empty reply. Please try again.");
      typing.remove();
      addChatMessage(payload.answer.trim());
      history.push({ role: "assistant", content: payload.answer.trim() });
      if (history.length > 16) history.splice(0, history.length - 16);
    } catch (error) {
      typing.remove();
      const offlineAnswer = chatMode === "helpdesk" ? localSupportAnswer(trimmed) : null;
      const message = offlineAnswer
        ? `${offlineAnswer}\n\nAI connection unavailable: ${error.message}`
        : `I couldn’t reach the AI service: ${error.message} To enable open-ended answers, configure the server-side API key and run server.ps1.`;
      addChatMessage(message, "error-msg");
      history.pop();
    } finally {
      chatBusy = false;
      send.disabled = false;
      send.setAttribute("aria-label", "Send message");
      input.disabled = false;
      input.focus();
    }
  }

  async function checkAiStatus() {
    const status = $("#ai-status");
    if (!status) return;
    const label = $("span", status);
    try {
      const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error("AI status unavailable");
      status.classList.toggle("offline", !payload.configured);
      status.classList.remove("error");
      label.textContent = payload.configured ? `${payload.provider === "Google Gemini" ? "GEMINI" : "AI"} READY` : "AI NOT CONFIGURED";
      status.title = payload.configured
        ? `${payload.provider || "AI provider"} is configured for ${payload.model}; authentication is checked on the first reply.`
        : "Set GEMINI_API_KEY on the server and restart it for open-ended AI answers.";
      const canConfigureKey = payload.keyInputAvailable !== false;
      $("#gemini-api-key").disabled = !canConfigureKey;
      $("#save-gemini-key").disabled = !canConfigureKey;
      $("#clear-gemini-key").disabled = !canConfigureKey;
      if ($("#gemini-key-status")) {
        $("#gemini-key-status").textContent = payload.configured
          ? `${payload.provider} is configured (${payload.model}). The key is held in server memory and is not displayed here.`
          : !canConfigureKey
            ? "Gemini chat requires a private server. Key entry is disabled in this public static preview."
            : "The key is sent to Google when you ask a question. It stays in server memory until the server stops; it is not saved in this browser or a project file.";
      }
    } catch {
      status.classList.add("offline");
      label.textContent = "SERVER REQUIRED";
      status.title = "Open the site through server.ps1. A static file server does not include the AI endpoint.";
      $("#gemini-api-key").disabled = true;
      $("#save-gemini-key").disabled = true;
      $("#clear-gemini-key").disabled = true;
      if ($("#gemini-key-status")) $("#gemini-key-status").textContent = "Start this site with server.ps1 to securely submit a key to the local server. Key entry is disabled until the server is available.";
    }
  }

  async function setGeminiApiKey(key) {
    const response = await fetch("/api/gemini-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `The server rejected the key (${response.status}).`);
    return payload;
  }

  function initShared() {
    $("#theme-toggle").addEventListener("click", () => {
      const light = document.documentElement.dataset.theme !== "light";
      document.documentElement.dataset.theme = light ? "light" : "dark";
      $("#theme-toggle").setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
      try { localStorage.setItem("dealcockpit-theme", light ? "light" : "dark"); } catch { /* Theme remains available for this page view. */ }
    });
    try {
      const theme = localStorage.getItem("dealcockpit-theme");
      if (theme === "light") { document.documentElement.dataset.theme = theme; $("#theme-toggle").setAttribute("aria-label", "Switch to dark theme"); }
    } catch { /* Storage may be unavailable in private browsing. */ }
    $("#currency").addEventListener("change", () => {
      if ($("#screening")) { renderAllocation(); updateWaterfall(); }
      toast("Using illustrative fixed display conversion; not live FX.");
    });
    $("#open-shortcuts").addEventListener("click", openCommand);
    $("#command-input").addEventListener("input", () => { activeCommandIndex = 0; renderCommands($("#command-input").value); });
    $("#command-input").addEventListener("keydown", (event) => {
      const filtered = commands.filter((item) => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(event.target.value.toLowerCase()));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length) activeCommandIndex = (activeCommandIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
        renderCommands(event.target.value);
      } else if (event.key === "Enter" && filtered[activeCommandIndex]) { event.preventDefault(); const item = filtered[activeCommandIndex]; closeCommand(); item.action(); }
      else if (event.key === "Escape") closeCommand();
    });
    $("#command-overlay").addEventListener("click", (event) => { if (event.target === $("#command-overlay")) closeCommand(); });
    $("#menu-toggle").addEventListener("click", () => {
      const expanded = $("#menu-toggle").getAttribute("aria-expanded") === "true";
      $("#menu-toggle").setAttribute("aria-expanded", String(!expanded));
      $(".main-nav").classList.toggle("open", !expanded);
    });
    $$(".main-nav a").forEach((link) => link.addEventListener("click", () => { $(".main-nav").classList.remove("open"); $("#menu-toggle").setAttribute("aria-expanded", "false"); }));
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommand(); }
      else if (event.key === "Escape" && !$("#command-overlay").hidden) closeCommand();
    });
  }

  function init() {
    initShared();
    if (!$("#screening")) return;
    setFormData(sample);
    try {
      const pendingDeal = sessionStorage.getItem("dealcockpit-pending-deal");
      if (pendingDeal) {
        sessionStorage.removeItem("dealcockpit-pending-deal");
        const pending = JSON.parse(pendingDeal);
        if (Array.isArray(pending.records) && pending.records.length) loadDataset(pending.records, pending.filename || "Imported CSV");
        else setFormData(pending);
      }
    } catch (error) {
      try { sessionStorage.removeItem("dealcockpit-pending-deal"); } catch { /* Keep the page usable if storage is blocked. */ }
      toast(`Could not restore imported deal: ${error.message}`);
    }
    renderAllocation();
    renderPipeline();
    renderPreferenceStack();
    updateWaterfall();
    updateSafe();
    updateVotes();
    renderIcRadar();
    renderBenchmarks();
    renderCorrelation();
    renderPitchAnnotations();
    renderSensitivity();
    updateCounterproposal();
    wireDashboardAssistantLinks();

    inputIds.forEach((id) => $(`#${id}`).addEventListener("input", () => {
      if (id === "burn") $("#burn-slider").value = Math.min(2.5, Math.max(.05, Number($(`#${id}`).value) || .05));
      if (id === "revenue") $("#revenue-slider").value = Math.min(30, Math.max(0, Number($(`#${id}`).value) || 0));
      recalculate();
      renderBenchmarks();
      updateWaterfall();
    }));
    $("#category").addEventListener("change", recalculate);
    $("#investor").addEventListener("change", recalculate);
    $("#burn-slider").addEventListener("input", updateWhatIf);
    $("#revenue-slider").addEventListener("input", updateWhatIf);
    $("#reset-scenario").addEventListener("click", () => {
      $("#burn-slider").value = currentModel.inputs.burn;
      $("#revenue-slider").value = currentModel.inputs.revenue;
      updateWhatIf();
    });
    $("#exit-value").addEventListener("input", () => { $("#exit-slider").value = Math.min(1000, Math.max(10, Number($("#exit-value").value) || 10)); updateWaterfall(); });
    $("#exit-slider").addEventListener("input", () => { $("#exit-value").value = $("#exit-slider").value; updateWaterfall(); });
    $("#option-pool").addEventListener("input", updateWaterfall);
    $("#add-stack-round").addEventListener("click", () => {
      if (stackRounds.length >= 5) return toast("The demo stack supports up to five rounds.");
      stackRounds.push({ name: `Series ${String.fromCharCode(65 + stackRounds.length)}`, investment: 5, ownership: 10, multiple: 1, participation: "non" });
      renderPreferenceStack();
      updateWaterfall();
    });
    ["safe-investment", "safe-cap", "safe-discount", "safe-round"].forEach((id) => $(`#${id}`).addEventListener("input", updateSafe));
    $$("[data-safe]").forEach((button) => button.addEventListener("click", () => {
      safeType = button.dataset.safe;
      $$("[data-safe]").forEach((item) => item.classList.toggle("active", item === button));
      updateSafe();
    }));
    $("#market-category").addEventListener("change", updateMarket);
    $("#download-memo").addEventListener("click", downloadMemo);
    $("#sample-data").addEventListener("click", openSampleDeal);
    $("#sample-portfolio").addEventListener("click", loadSamplePortfolio);
    $("#browse-csv").addEventListener("click", () => $("#csv-file").click());
    $("#csv-file").addEventListener("change", (event) => loadCsv(event.target.files[0]));
    const dropZone = $("#drop-zone");
    ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
    dropZone.addEventListener("drop", (event) => loadCsv(event.dataTransfer.files[0]));
    $("#add-deal").addEventListener("click", addDeal);
    $$("[data-vote]").forEach((button) => button.addEventListener("click", () => {
      const risks = $$(".risk-options input:checked").map((input) => input.value);
      if (!risks.length) {
        $("#vote-confirmation").textContent = "Select at least one risk justification before recording a vote.";
        $(".risk-options input").find((input) => !input.checked)?.focus();
        return;
      }
      const vote = button.dataset.vote;
      votes[vote] += 1;
      voteRecords.push({ vote, risks, ratings: [...icRatings] });
      updateVotes();
      const voteName = { strong: "Strong buy", conditional: "Conditional buy", pass: "Pass" }[vote];
      $("#vote-confirmation").textContent = `${voteName} vote recorded locally with ${risks.join(", ")} justification. ${voteRecords.length} local demo vote${voteRecords.length === 1 ? "" : "s"} total.`;
    }));
    ["seed-weight", "seriesa-weight", "followon-weight", "macro-failure"].forEach((id) => $(`#${id}`).addEventListener("input", updateStageAllocation));
    ["term-burn", "term-valuation", "term-tranche-one", "term-milestone", "term-tranches", "term-board-seat"].forEach((id) => $(`#${id}`).addEventListener("input", updateCounterproposal));
    $("#open-counterproposal").addEventListener("click", () => {
      $("#counterproposal-drawer").classList.toggle("is-open");
      $("#term-burn").focus();
    });
    $("#download-terms").addEventListener("click", () => {
      updateCounterproposal();
      saveBlob(termSummary, "text/markdown;charset=utf-8", "illustrative-counter-proposal.md");
      toast("Illustrative counter-proposal downloaded.");
    });
    $("#copy-terms").addEventListener("click", async () => {
      updateCounterproposal();
      try { await navigator.clipboard.writeText(termSummary); toast("Counter-proposal copied."); }
      catch { toast("Clipboard access is unavailable; download the clause summary instead."); }
    });
    $("#save-annotation").addEventListener("click", savePitchAnnotation);
    $("#pitch-file").addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return toast("Choose a PDF file to preview.");
      if (pitchObjectUrl) URL.revokeObjectURL(pitchObjectUrl);
      pitchObjectUrl = URL.createObjectURL(file);
      $("#pitch-viewer").innerHTML = `<object data="${pitchObjectUrl}#toolbar=1&navpanes=0" type="application/pdf" aria-label="${escapeHtml(file.name)} PDF preview"><p>PDF preview is not available in this browser. <a href="${pitchObjectUrl}" target="_blank" rel="noopener">Open ${escapeHtml(file.name)} in a new tab</a>.</p></object>`;
      $("#pitch-file-status").textContent = `${file.name} · local browser preview`;
    });
    $("#play-brief").addEventListener("click", playAudioBrief);
    $("#stop-brief").addEventListener("click", () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    });
    $("#chat-form").addEventListener("submit", (event) => { event.preventDefault(); sendChat($("#chat-input").value); });
    $("#gemini-key-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const field = $("#gemini-api-key");
      const button = $("#save-gemini-key");
      const status = $("#gemini-key-status");
      const key = field.value.trim();
      if (!key) {
        status.textContent = "Paste a Gemini API key first.";
        field.focus();
        return;
      }
      button.disabled = true;
      status.textContent = "Sending the key to the local server…";
      try {
        const payload = await setGeminiApiKey(key);
        field.value = "";
        status.textContent = `${payload.provider} configured (${payload.model}). The key is held in server memory and is not displayed or saved in this browser.`;
        toast("Gemini is ready for both assistant chat modes.");
        await checkAiStatus();
      } catch (error) {
        status.textContent = `Could not configure Gemini: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    $("#toggle-gemini-key").addEventListener("click", (event) => {
      const field = $("#gemini-api-key");
      const reveal = field.type === "password";
      field.type = reveal ? "text" : "password";
      event.currentTarget.textContent = reveal ? "Hide key" : "Show key";
      event.currentTarget.setAttribute("aria-pressed", String(reveal));
    });
    $("#clear-gemini-key").addEventListener("click", async () => {
      const status = $("#gemini-key-status");
      status.textContent = "Clearing the server’s in-memory Gemini key…";
      try {
        await setGeminiApiKey("");
        $("#gemini-api-key").value = "";
        status.textContent = "The saved Gemini key has been cleared from server memory.";
        toast("Gemini key cleared.");
        await checkAiStatus();
      } catch (error) {
        status.textContent = `Could not clear Gemini key: ${error.message}`;
      }
    });
    $$(".assistant-tab").forEach((tab) => tab.addEventListener("click", () => updateAssistantMode(tab.dataset.chatMode)));
    $("#clear-chat").addEventListener("click", () => {
      chatHistory[chatMode] = [];
      $("#chat-messages").replaceChildren();
      addChatMessage(assistantWelcome(chatMode));
      $("#chat-input").focus();
    });
    $$(".chat-suggestions button").forEach((button) => button.addEventListener("click", () => sendChat(button.textContent)));
    checkAiStatus();
  }

  init();
})();
