// The test runner prints console output (the golden and frame tests print
// their fixtures that way when regenerating); the plugin's own lib has no DOM.
declare const console: { log(...data: unknown[]): void }
