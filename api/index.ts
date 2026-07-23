// Vercel serverless entry point. Express apps are valid (req, res) handlers,
// so re-exporting the configured app directly is Vercel's documented,
// supported pattern for Express — no serverless-http adapter needed.
export { default } from '../backend/src/server';
