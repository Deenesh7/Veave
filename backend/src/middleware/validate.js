const { ValidationError } = require('../utils/errors');

const validateBody = (fields) => {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field] === undefined) {
        return next(new ValidationError(`Missing required field: ${field}`));
      }
    }
    next();
  };
};

module.exports = { validateBody };
