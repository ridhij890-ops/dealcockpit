# DealCockpit

A responsive venture analytics cockpit prototype. Its financial demo calculations run in the browser. The optional AI chat uses a small local PowerShell proxy so the provider key is never embedded in browser code; deal context and conversation messages are sent to the configured AI provider when enabled.

## Run locally

**Quickest:** open `index.html` in a modern browser. Use the top navigation to move between the separate **Home**, **Features**, **Core engines**, and **About** pages.

**Static site only:** open `index.html` directly, or from this folder run:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>. This static-only option does not provide the AI API; the help desk can answer a few built-in product FAQs, while general AI answers require the local proxy below.

**Enable open-ended AI with Google Gemini:** start the included proxy, open Core engines, expand **Configure Gemini API key**, paste your Google AI Studio key, and choose **Save for this session**. The local server keeps the key in memory only and clears it when stopped; it is not saved in browser storage or project files. Use **Clear saved key** to remove it sooner. A connected key serves both the Deal Analyst and Help Desk.

```powershell
.\server.ps1
```

Open <http://localhost:8000> and keep that PowerShell window running. The key is sent to this local server and used for requests to Google; analyst messages also include the current illustrative deal inputs. Requests may incur charges under your Gemini API account. Only enter your key on a device and local server you trust. Without a key, the app clearly shows that general AI is unavailable and still answers supported product help questions locally. The server retains compatibility with an OpenAI-compatible provider via `OPENAI_API_KEY`; `AI_MODEL` and `AI_BASE_URL` can override the model and endpoint.

If port 8000 is already occupied, start it on another port with `.\server.ps1 -Port 8001` and open <http://localhost:8001>.

- Home: <http://localhost:8000/>
- Features: <http://localhost:8000/features.html>
- Core engines: <http://localhost:8000/engines.html>
- About: <http://localhost:8000/about.html>

## Features

- Deal screening with the supplied illustrative success-probability and ROI equations, risk heuristics, confidence band, and coefficient contribution view.
- CSV import/dropzone on Core engines (the file picker shows all file types, but only CSV imports are supported; one startup per row, requiring `valuation`, `ltv_cac`, `rounds`, `burn`, `revenue`/`arr`, `funding`, `experience`, and `margin`, with optional `name`, `category`, `investor`, and `stage`).
- Multi-row CSV imports replace the demo deal universe: screening selects the first imported startup, pipeline and 2–4 deal comparisons use the imported rows, sector exposure, deployment total, dataset score average/median, and Pearson feature correlations are calculated from the file. `Screen this deal` updates screening and dependent calculations for any imported company; editing its deal inputs also updates its pipeline/comparison metrics and dataset summaries. Scenario, market, counter-proposal, SAFE/exit, IC scorecard, and AI context follow the active imported startup. Stage allocation is inferred from funding rounds unless adjusted. Cap-table preferences are explicitly labeled as proxies unless separately edited because the supported CSV does not contain legal preference terms.
- Burn/revenue scenarios, illustrative portfolio allocation, drag-and-drop deal pipeline, simplified liquidation waterfall, and pre-/post-money SAFE estimate.
- Illustrative ARR peer ranges, browser-session IC voting, correlation snapshot, AI analyst and product help desk chat (requires server-side API configuration for open-ended answers), and downloadable Markdown evaluation memo.
- Two-variable 5×5 revenue-growth/burn sensitivity grid with ROI, modeled survival odds, and runway; editable stage allocation and macro-failure return simulation.
- Cap-table preference-stack builder with reorderable rounds, ownership/option-pool inputs, participation terms, and live exit-waterfall payouts; editable counter-proposal clauses with recalculated demo outputs.
- Six-pillar IC radar and risk-tagged local voting; compare 2–4 pipeline deals; local PDF preview with page-linked claim notes; browser text-to-speech executive brief.
- Equation-based cumulative feature-attribution waterfall. It is not SHAP: the app does not train models or calculate SHAP values. Pitch-deck notes can jump to a PDF page but do not extract or automatically highlight PDF text.
- Each Core Engines dashboard includes an “Ask AI about this” shortcut. The Deal Analyst receives the live screening inputs and current scenario, portfolio, pipeline, capital, committee, comparison, market, and pitch-review state as illustrative context.
- Keyboard command palette via Ctrl/Cmd+K, dark/light themes, responsive navigation, and a fixed illustrative display-currency conversion selector.
- Phone-friendly layouts with a compact menu, stacked content, touch-sized controls, and no horizontal page scrolling at common mobile widths.

## Important limitations

The model, peer ranges, confidence bands, return assumptions, sensitivity survival odds, and demo portfolio are illustrative and are not validated backtesting or investment performance. With a CSV loaded, sector exposure, scores, and correlations are calculated from the uploaded rows, but those sample statistics are descriptive and may be unreliable for a small dataset. Stage mix is inferred from funding-round count (0–1 Seed, 2–3 Series A, 4+ follow-on). The feature waterfall shows direct equation coefficient contributions; it is not SHAP and does not imply causality. IC voting is local to the page, not live collaboration. SAFE and liquidation outputs simplify legal/economic mechanics; the imported cap-table preference row is only a proxy based on aggregate funding and valuation, not actual capitalization data. Currency conversion uses fixed illustrative display rates, not live exchange rates. Dashboard context sent to the AI is illustrative and may include current scenario assumptions, deal pipeline entries, IC ratings and votes, and saved pitch-review notes. AI answers may be wrong or incomplete; verify important claims independently. This prototype is not investment advice.
