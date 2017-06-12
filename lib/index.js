'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RollbackError = undefined;

exports.default = function (schema, opts) {
  var options = (0, _lodash.merge)({}, defaultOptions, opts

  // get _id type from schema
  );options._idType = schema.tree._id.type;

  // validate parameters
  (0, _assert2.default)(options.mongoose, '`mongoose` option must be defined');
  (0, _assert2.default)(options.name, '`name` option must be defined');
  (0, _assert2.default)(!schema.methods.data, 'conflicting instance method: `data`');
  (0, _assert2.default)(options._idType, 'schema is missing an `_id` property'

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  );schema.methods.data = function () {
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

  // roll the document back to the state of a given patch id
  schema.methods.rollback = function (patchId, data) {
    var _this = this;

    return this.patches.find({ ref: this.id }).sort({ date: 1 }).exec().then(function (patches) {
      return new _bluebird2.default(function (resolve, reject) {
        // patch doesn't exist
        if (!~(0, _lodash.map)(patches, 'id').indexOf(patchId)) {
          return reject(new RollbackError('patch doesn\'t exist'));
        }

        // get all patches that should be applied
        var apply = (0, _lodash.dropRightWhile)(patches, function (patch) {
          return patch.id !== patchId;
        }

        // if the patches that are going to be applied are all existing patches,
        // the rollback attempts to rollback to the latest patch
        );if (patches.length === apply.length) {
          return reject(new RollbackError('rollback to latest patch'));
        }

        // apply patches to `state`
        var state = {};
        apply.forEach(function (patch) {
          _fastJsonPatch2.default.apply(state, patch.ops, true);
        }

        // save new state and resolve with the resulting document
        );_this.set((0, _lodash.merge)(data, state)).save().then(resolve).catch(reject);
      });
    });
  };

  // create patch model, enable static model access via `Patches` and
  // instance method access through an instances `patches` property
  var Patches = createPatchModel(options);
  schema.statics.Patches = Patches;
  schema.virtual('patches').get(function () {
    return Patches;
  }

  // after a document is initialized or saved, fresh snapshots of the
  // documents data are created
  );var snapshot = function snapshot() {
    this._original = toJSON(this.data());
  };
  schema.post('init', snapshot);
  schema.post('save', snapshot

  // when a document is removed and `removePatches` is not set to false ,
  // all patch documents from the associated patch collection are also removed
  );schema.pre('remove', function (next) {
    if (!options.removePatches) {
      return next();
    }

    var ref = this._id;

    this.patches.find({ ref: ref }).then(function (patches) {
      return (0, _bluebird.join)(patches.map(function (patch) {
        return patch.remove();
      }));
    }).then(next).catch(next);
  }

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  );schema.pre('save', function (next) {
    var _this2 = this;

    var ref = this._id;

    var ops = _fastJsonPatch2.default.compare(this.isNew ? {} : this._original, toJSON(this.data())

    // don't save a patch when there are no changes to save
    );if (!ops.length) {
      return next();
    }

    // assemble patch data
    var data = { ops: ops, ref: ref };
    (0, _lodash.each)(options.includes, function (type, name) {
      data[name] = _this2[type.from || name];
    });

    this.patches.create(data).then(next).catch(next);
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
  removePatches: true,
  transforms: [_humps.pascalize, _humps.decamelize]

  // used to convert bson to json - especially ObjectID references need
  // to be converted to hex strings so that the jsonpatch `compare` method
  // works correctly
};var toJSON = function toJSON(obj) {
  return JSON.parse(JSON.stringify(obj));
};