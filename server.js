import { createControlPlaneRequestHandler } from './dist/server.js';

export default createControlPlaneRequestHandler({ serviceName: 'ai-control-plane-api' });
