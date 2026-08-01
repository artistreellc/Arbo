// Vercel entrypoint (D41): every route of the ARBOR server as one serverless
// function. Same handler as node:http — vercel.json rewrites all paths here.
import { createArborRequestHandler } from '../src/server.js';

export default createArborRequestHandler();
