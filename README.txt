LOANLENS — STATIC WEB APPLICATION
=================================

PROJECT TYPE
- Static frontend web application only.
- Built with HTML5, CSS3 and vanilla JavaScript (ES6+).
- No backend, server-side code, database, API server, npm install or build step is required to use the website.
- LocalStorage is used only in the visitor's own browser for saved inputs, scenarios and a bounded local audit history.

FEATURES
- Responsive and accessible loan advisor interface.
- EMI calculator with amount, rate and tenure controls.
- Four loan categories: home, auto, education and personal.
- Bank comparison using a bundled reference catalogue (not live bank quotes).
- Multiple lump-sum prepayment events and estimated penalty modelling.
- Month-wise / year-wise amortization schedule.
- Principal-interest charts and cumulative repayment chart, with a fallback if Chart.js is unavailable.
- PDF export with a print fallback if PDF libraries are unavailable.
- Inflation-adjusted repayment estimate, eligibility estimate and tax deduction estimator.
- Local scenario save and restore; data never leaves the browser.
- Explicit JavaScript input validation, safe numeric bounds, HTML escaping for dynamic lender text, URL protocol allow-listing, and global error reporting.
- Financial calculation logic is isolated in loan-core.js, independent from the DOM and browser storage.

PROJECT FILES
- index.html          Application structure and semantic page sections.
- style.css           Responsive layout, components and accessibility states.
- script.js           UI state, events, rendering, charts, storage and exports.
- loan-core.js        Pure EMI, amortization, prepayment and validation functions.
- banks.json         Readable lender reference catalogue; an identical embedded copy
                     in script.js keeps the app usable when opened via file://.
- tests/loan-core.test.js  Automated regression, validation and data-integrity tests.

HOW TO RUN THE WEBSITE
1. Extract the ZIP file.
2. Open the folder in VS Code.
3. Open index.html using the Live Server extension, OR double-click index.html to open it in a modern browser.
4. No npm commands or backend startup are required.

HOW TO RUN AUTOMATED TESTS (OPTIONAL DEVELOPMENT CHECK)
- Install Node.js only if you want to run the test suite; Node.js is NOT needed to run the website.
- Open a terminal in this project folder and run:
    node --test tests/loan-core.test.js
- The included suite currently contains 39 automated tests for input validation, EMI reference values, amortization identities, prepayments, fees, edge cases, catalogue integrity, safe rendering hooks and static script wiring.

IMPORTANT LIMITATIONS
- This is deliberately a static application. Browser LocalStorage is device/browser-specific and is not a cloud database or server-side persistence.
- Client-side validation improves robustness but cannot provide server-side enforcement; there is no backend by design.
- Chart.js, jsPDF, jsPDF-AutoTable and Google Fonts are loaded from public CDNs. Their enhanced features require an internet connection; the core calculator and bundled lender catalogue work locally.
- Lender rates and charges are published/sample reference inputs and may change. They are not personalised or live bank offers. Confirm the sanctioned rate, fee, taxes and prepayment terms with the lender.
- Tax and eligibility tools are indicative estimates, not financial, legal or tax advice.
- Automated tests passing demonstrates the tested calculation and data behaviours; it does not guarantee a particular external evaluator score. Final marks depend on the evaluator's full specification and review.
