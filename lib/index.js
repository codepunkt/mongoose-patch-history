'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RollbackError = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.default = function (schema, opts) {
  var options = (0, _lodash.merge)({}, defaultOptions, opts);

  // get _id type from schema
  options._idType = schema.tree._id.type;

  // transform excludes option
  options.excludes = options.excludes.map(getArrayFromPath);

  // validate parameters
  (0, _assert2.default)(options.mongoose, '`mongoose` option must be defined');
  (0, _assert2.default)(options.name, '`name` option must be defined');
  (0, _assert2.default)(!schema.methods.data, 'conflicting instance method: `data`');
  (0, _assert2.default)(options._idType, 'schema is missing an `_id` property');

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      transform: function transform(doc, ret, options) {
        delete ret._id;
        // if timestamps option is set on schema, ignore timestamp fields
        if (schema.options.timestamps) {
          delete ret[schema.options.timestamps.createdAt || 'createdAt'];
          delete ret[schema.options.timestamps.updatedAt || 'updatedAt'];
        }
      }
    });
  };

  // roll the document back to the state of a given patch id()
  schema.methods.rollback = function (patchId, data) {
    var _this = this;

    var save = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

    return this.patches.find({ ref: this.id }).sort({ date: 1 }).exec().then(function (patches) {
      return new _bluebird2.default(function (resolve, reject) {
        // patch doesn't exist
        if (!~(0, _lodash.map)(patches, 'id').indexOf(patchId)) {
          return reject(new RollbackError("patch doesn't exist"));
        }

        // get all patches that should be applied
        var apply = (0, _lodash.dropRightWhile)(patches, function (patch) {
          return patch.id !== patchId;
        });

        // if the patches that are going to be applied are all existing patches,
        // the rollback attempts to rollback to the latest patch
        if (patches.length === apply.length) {
          return reject(new RollbackError('rollback to latest patch'));
        }

        // apply patches to `state`
        var state = {};
        apply.forEach(function (patch) {
          _fastJsonPatch2.default.applyPatch(state, patch.ops, true);
        });

        // set new state
        _this.set((0, _lodash.merge)(data, state));

        // in case of save, save it back to the db and resolve
        if (save) {
          _this.save().then(resolve).catch(reject);
        } else resolve(_this);
      });
    });
  };

  // create patch model, enable static model access via `Patches` and
  // instance method access through an instances `patches` property
  var Patches = createPatchModel(options);
  schema.statics.Patches = Patches;
  schema.virtual('patches').get(function () {
    return Patches;
  });

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  var snapshot = function snapshot() {
    this._original = toJSON(this.data());
  };
  schema.post('init', snapshot);
  schema.post('save', snapshot);

  // when a document is removed and `removePatches` is not set to false ,
  // all patch documents from the associated patch collection are also removed
  function deletePatches(document) {
    var ref = document._id;

    return document.patches.find({ ref: document._id }).then(function (patches) {
      return (0, _bluebird.join)(patches.map(function (patch) {
        return patch.remove();
      }));
    });
  }

  schema.pre('remove', function (next) {
    if (!options.removePatches) {
      return next();
    }

    deletePatches(this).then(function () {
      return next();
    }).catch(next);
  });

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  function createPatch(document) {
    var queryOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    var ref = document._id;

    var ops = _fastJsonPatch2.default.compare(document.isNew ? {} : document._original || {}, toJSON(document.data()));
    if (options.excludes.length > 0) {
      ops = ops.filter(function (op) {
        var pathArray = getArrayFromPath(op.path);
        return !options.excludes.some(function (exclude) {
          return isPathContained(exclude, pathArray);
        }) && options.excludes.every(function (exclude) {
          return deepRemovePath(op, exclude);
        });
      });
    }

    // don't save a patch when there are no changes to save
    if (!ops.length) {
      return _bluebird2.default.resolve();
    }

    // track original values if enabled
    if (options.trackOriginalValue) {
      ops.map(function (entry) {
        var path = (0, _lodash.tail)(entry.path.split('/')).join('.');
        entry.originalValue = (0, _lodash.get)(document.isNew ? {} : document._original, path);
      });
    }

    // assemble patch data
    var data = { ops: ops, ref: ref };
    (0, _lodash.each)(options.includes, function (type, name) {
      data[name] = document[type.from || name] || queryOptions[type.from || name];
    });

    return document.patches.create(data);
  }

  schema.pre('save', function (next) {
    createPatch(this).then(function () {
      return next();
    }).catch(next);
  });

  schema.pre('findOneAndRemove', function (next) {
    if (!options.removePatches) {
      return next();
    }

    this.model.findOne(this._conditions).then(function (original) {
      return deletePatches(original);
    }).then(function () {
      return next();
    }).catch(next);
  });

  schema.pre('findOneAndUpdate', preUpdateOne);

  function preUpdateOne(next) {
    var _this2 = this;

    this.model.findOne(this._conditions).then(function (original) {
      if (original) _this2._originalId = original._id;
      original = original || new _this2.model({});
      _this2._original = toJSON(original.data());
    }).then(function () {
      return next();
    }).catch(next);
  }

  schema.post('findOneAndUpdate', function (doc, next) {
    if (!this.options.new) {
      return postUpdateOne.call(this, {}, next);
    }

    doc._original = this._original;
    createPatch(doc, this.options).then(function () {
      return next();
    }).catch(next);
  });

  function postUpdateOne(result, next) {
    var _this3 = this;

    if (result.nModified === 0) return;

    var conditions = void 0;
    if (this._originalId) conditions = { _id: { $eq: this._originalId } };else conditions = mergeQueryConditionsWithUpdate(this._conditions, this._update);

    this.model.findOne(conditions).then(function (doc) {
      if (!doc) return next();
      doc._original = _this3._original;
      return createPatch(doc, _this3.options);
    }).then(function () {
      return next();
    }).catch(next);
  }

  schema.pre('updateOne', preUpdateOne);
  schema.post('updateOne', postUpdateOne);

  function preUpdateMany(next) {
    var _this4 = this;

    this.model.find(this._conditions).then(function (originals) {
      var originalIds = [];
      var originalData = [];
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = originals[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var original = _step.value;

          originalIds.push(original._id);
          originalData.push(toJSON(original.data()));
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      _this4._originalIds = originalIds;
      _this4._originals = originalData;
    }).then(function () {
      return next();
    }).catch(next);
  }

  function postUpdateMany(result, next) {
    var _this5 = this;

    if (result.nModified === 0) return;

    var conditions = void 0;
    if (this._originalIds.length === 0) conditions = mergeQueryConditionsWithUpdate(this._conditions, this._update);else conditions = { _id: { $in: this._originalIds } };

    this.model.find(conditions).then(function (docs) {
      return _bluebird2.default.all(docs.map(function (doc, i) {
        doc._original = _this5._originals[i];
        return createPatch(doc, _this5.options);
      }));
    }).then(function () {
      return next();
    }).catch(next);
  }

  schema.pre('updateMany', preUpdateMany);
  schema.post('updateMany', postUpdateMany);

  schema.pre('update', function (next) {
    if (this.options.multi) {
      preUpdateMany.call(this, next);
    } else {
      preUpdateOne.call(this, next);
    }
  });
  schema.post('update', function (result, next) {
    if (this.options.many) {
      postUpdateMany.call(this, result, next);
    } else {
      postUpdateOne.call(this, result, next);
    }
  });
};

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _mongoose = require('mongoose');

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _fastJsonPatch = require('fast-json-patch');

var _fastJsonPatch2 = _interopRequireDefault(_fastJsonPatch);

var _humps = require('humps');

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var RollbackError = exports.RollbackError = function RollbackError(message, extra) {
  Error.captureStackTrace(this, this.constructor);
  this.name = 'RollbackError';
  this.message = message;
};

require('util').inherits(RollbackError, Error);

var createPatchModel = function createPatchModel(options) {
  var def = {
    date: { type: Date, required: true, default: Date.now },
    ops: { type: [], required: true },
    ref: { type: options._idType, required: true, index: true }
  };

  (0, _lodash.each)(options.includes, function (type, name) {
    def[name] = (0, _lodash.omit)(type, 'from');
  });

  var PatchSchema = new _mongoose.Schema(def);

  return options.mongoose.model(options.transforms[0]('' + options.name), PatchSchema, options.transforms[1]('' + options.name));
};

var defaultOptions = {
  includes: {},
  excludes: [],
  removePatches: true,
  transforms: [_humps.pascalize, _humps.decamelize],
  trackOriginalValue: false
};

var ARRAY_INDEX_WILDCARD = '*';

/**
 * Splits a json-patch-path of form `/path/to/object` to an array `['path', 'to', 'object']`.
 * Note: `/` is returned as `[]`
 *
 * @param {string} path Path to split
 */
var getArrayFromPath = function getArrayFromPath(path) {
  return path.replace(/^\//, '').split('/');
};

/**
 * Checks the provided `json-patch-operation` on `excludePath`. This check is joins the `path` and `value` property of the `operation` and removes any hit.
 *
 * @param {import('fast-json-patch').Operation} patch operation to check with `excludePath`
 * @param {String[]} excludePath Path to property to remove from value of `operation`
 *
 * @return `false` if `patch.value` is `{}` or `undefined` after remove, `true` in any other case
 */
var deepRemovePath = function deepRemovePath(patch, excludePath) {
  var operationPath = sanitizeEmptyPath(getArrayFromPath(patch.path));

  // first check if the base path of the json-patch overlaps with the path we want to exclude
  if (isPathContained(operationPath, excludePath)) {
    var value = patch.value;

    // because the paths overlap start at patchPath.length
    // e.g.
    // patch: { path:'/object', value:{ property: 'test' } }
    // pathToExclude: '/object/property'
    // need to start at array idx 1, because value starts at idx 0

    var _loop = function _loop(i) {
      if (excludePath[i] === ARRAY_INDEX_WILDCARD && Array.isArray(value)) {
        value.forEach(function (elem) {
          // start over with each array element and make a fresh check
          // Note: it can happen that array elements are rendered to: {}
          //         we need to keep them to keep the order of array elements consistent
          deepRemovePath({ path: '/', value: elem }, excludePath.slice(i + 1));
        });

        // If the patch value has turned to {} return false so this patch can be filtered out
        if (Object.keys(patch.value).length === 0) return {
            v: false
          };
        return {
          v: true
        };
      }
      value = value[excludePath[i]];

      if (typeof value === 'undefined') return {
          v: true
        };
    };

    for (var i = operationPath.length; i < excludePath.length - 1; i++) {
      var _ret = _loop(i);

      if ((typeof _ret === 'undefined' ? 'undefined' : _typeof(_ret)) === "object") return _ret.v;
    }
    if (typeof value[excludePath[excludePath.length - 1]] === 'undefined') return true;else {
      delete value[excludePath[excludePath.length - 1]];
      // If the patch value has turned to {} return false so this patch can be filtered out
      if (Object.keys(patch.value).length === 0) return false;
    }
  }
  return true;
};

/**
 * Sanitizes a path `['']` to be used with `isPathContained()`
 * @param {String[]} path
 */
var sanitizeEmptyPath = function sanitizeEmptyPath(path) {
  return path.length === 1 && path[0] === '' ? [] : path;
};

// Checks if 'fractionPath' is contained in fullPath
// Exp. 1: fractionPath '/path/to',              fullPath '/path/to/object'       => true
// Exp. 2: fractionPath '/arrayPath/*/property', fullPath '/arrayPath/1/property' => true
var isPathContained = function isPathContained(fractionPath, fullPath) {
  return fractionPath.every(function (entry, idx) {
    return entryIsIdentical(entry, fullPath[idx]) || matchesArrayWildcard(entry, fullPath[idx]);
  });
};

var entryIsIdentical = function entryIsIdentical(entry1, entry2) {
  return entry1 === entry2;
};

var matchesArrayWildcard = function matchesArrayWildcard(entry1, entry2) {
  return isArrayIndexWildcard(entry1) && isIntegerGreaterEqual0(entry2);
};

var isArrayIndexWildcard = function isArrayIndexWildcard(entry) {
  return entry === ARRAY_INDEX_WILDCARD;
};

var isIntegerGreaterEqual0 = function isIntegerGreaterEqual0(entry) {
  return Number.isInteger(Number(entry)) && Number(entry) >= 0;
};

// used to convert bson to json - especially ObjectID references need
// to be converted to hex strings so that the jsonpatch `compare` method
// works correctly
var toJSON = function toJSON(obj) {
  return JSON.parse(JSON.stringify(obj));
};

// helper function to merge query conditions after an update has happened
// usefull if a property which was initially defined in _conditions got overwritten
// with the update
var mergeQueryConditionsWithUpdate = function mergeQueryConditionsWithUpdate(_conditions, _update) {
  var update = _update ? _update.$set || _update : _update;
  var conditions = Object.assign({}, conditions, update);

  // excluding updates other than $set
  Object.keys(conditions).forEach(function (key) {
    if (key.includes('$')) delete conditions[key];
  });
  return conditions;
};