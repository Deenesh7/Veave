const AIUsage = require('../models/AIUsage');

exports.getUsage = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const query = req.user?.id ? { userId: req.user.id } : {};

    const usage = await AIUsage.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('projectId', 'name');

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
    const match = req.user?._id ? { userId: req.user._id } : {};
    const summary = await AIUsage.aggregate([
      ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
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

    const latest = await AIUsage.findOne().sort({ createdAt: -1 });

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
    const { projectId } = req.params;
    const records = await AIUsage.find({ projectId }).sort({ createdAt: -1 });
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
