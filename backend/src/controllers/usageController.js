const AIUsage = require('../models/AIUsage');

exports.getUsage = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ success: false, error: 'Log in to view usage.' });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = { userId: req.user.id };

    const usage = await AIUsage.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('projectId', 'name')
      .lean();

    const total = await AIUsage.countDocuments(query);

    res.status(200).json({
      success: true,
      data: usage,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getUsageSummary = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ success: false, error: 'Log in to view usage.' });
    const match = { userId: req.user._id };
    const summary = await AIUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ]);

    const latest = await AIUsage.findOne(match).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      success: true,
      data: {
        ...(summary.length > 0 ? summary[0] : { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0, totalCost: 0 }),
        latest
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getProjectUsage = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ success: false, error: 'Log in to view usage.' });
    const { projectId } = req.params;
    const records = await AIUsage.find({ projectId, userId: req.user._id }).sort({ createdAt: -1 }).limit(1000).lean();
    const totalTokens = records.reduce((acc, r) => acc + (r.totalTokens || 0), 0);
    const inputTokens = records.reduce((acc, r) => acc + (r.inputTokens || 0), 0);
    const outputTokens = records.reduce((acc, r) => acc + (r.outputTokens || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        records,
        summary: {
          totalTokens,
          inputTokens,
          outputTokens,
          totalGenerations: records.length,
          lastRecord: records[0] || null
        }
      }
    });
  } catch (err) {
    next(err);
  }
};
