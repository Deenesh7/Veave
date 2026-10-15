const agentService = require('../services/agent/agentService');
const { runDualAgent } = require('../services/agent/dualAgentService');
const { submitDecision } = require('../services/agent/planApproval');
const logger = require('../utils/logger');

// Store abort controllers for stopping generation
const activeGenerations = new Map();

exports.sendMessage = async (req, res, next) => {
  const { projectId } = req.params;
  const { message, imageBase64, selectedElement } = req.body;
  const userId = req.user ? req.user.id : null;
  const generationId = `${userId || 'guest'}-${projectId}-${Date.now()}`;

  // Use AbortController for cancelation
  const abortController = new AbortController();
  activeGenerations.set(generationId, abortController);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.on('close', () => {
    logger.info(`Client disconnected during generation ${generationId}`);
    abortController.abort();
    activeGenerations.delete(generationId);
  });

  try {
    // We send an initial event to let the client know we're starting
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'started', generationId })}\n\n`);

    const onChunk = (chunk) => {
      if (abortController.signal.aborted) {
        return;
      }
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    };

    const result = await agentService.processStreamingMessage(userId, projectId, message, imageBase64, onChunk, abortController.signal, selectedElement);

    if (!abortController.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
    }
  } catch (error) {
    logger.error(`Error in agent generation: ${error.message}`);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    }
  } finally {
    activeGenerations.delete(generationId);
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
};

exports.stopGeneration = async (req, res, next) => {
  try {
    const { generationId } = req.body;
    if (generationId && activeGenerations.has(generationId)) {
      activeGenerations.get(generationId).abort();
      activeGenerations.delete(generationId);
      res.status(200).json({ success: true, message: 'Generation stopped' });
    } else {
      res.status(404).json({ success: false, error: 'Generation not found or already completed' });
    }
  } catch (error) {
    next(error);
  }
};

exports.planAndBuild = async (req, res) => {
  const { projectId } = req.params;
  const { message, sourceUrl, maxRoutes } = req.body || {};
  const userId = req.user ? req.user.id : null;
  if (!message || !String(message).trim()) {
    return res.status(400).json({ success: false, error: 'message is required' });
  }
  const generationId = `${userId || 'guest'}-${projectId}-${Date.now()}`;
  const abortController = new AbortController();
  activeGenerations.set(generationId, abortController);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.on('close', () => {
    abortController.abort();
    activeGenerations.delete(generationId);
  });

  const send = (payload) => {
    if (!abortController.signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    send({ type: 'status', message: 'started', generationId });
    const result = await runDualAgent({
      runId: generationId, userId, projectId, request: message, sourceUrl, maxRoutes,
      signal: abortController.signal, onEvent: send
    });
    if (!result.cancelled) send({ type: 'complete', result });
  } catch (error) {
    logger.error(`Error in plan-and-build: ${error.message}`);
    send({ type: 'error', error: error.message });
  } finally {
    activeGenerations.delete(generationId);
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
};


exports.decidePlan = (req, res) => {
  const { projectId, runId } = req.params;
  const { decision } = req.body || {};
  if (!['approve', 'cancel'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be "approve" or "cancel"' });
  }
  const userId = req.user ? req.user.id : null;
  const outcome = submitDecision(runId, decision, { userId, projectId });
  if (outcome === 'forbidden') return res.status(403).json({ success: false, error: 'Not allowed' });
  if (outcome === 'not_found') return res.status(404).json({ success: false, error: 'No plan is waiting for approval' });
  return res.status(200).json({ success: true, decision });
};
