'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function (schema, opts) {
  var options = (0, _lodash.merge)({}, defaultOptions, opts);

  // validate parameters
  (0, _assert2.default)(options.mongoose, '`mongoose` option must be defined');
  (0, _assert2.default)(options.name, '`name` option must be defined');
  (0, _assert2.default)(!schema.methods.data, 'conflicting instance method: `data`');

  // used to compare instance data snapshots. depopulates instance,
  // removes version key and object id
  schema.methods.data = function () {
    return this.toObject({
      depopulate: true,
      versionKey: false,
      // TODO don't filter out createdAt and updatedAt only, but create
      // a blacklist of properties that should be ignored while comparing
      transform: function transform(doc, ret, options) {
        delete ret._id;
        delete ret.createdAt;
        delete ret.updatedAt;
      }
    });
  };

  // TODO comment this
  schema.methods.rollback = function (patchId) {
    var _this = this;

    return this.patches.find({ ref: this.id }).sort({ date: 1 }).exec().then(function (patches) {
      return new _bluebird2.default(function (resolve, reject) {
        var ids = (0, _lodash.map)(patches, 'id');
        if (! ~ids.indexOf(patchId)) return resolve();
        var apply = (0, _lodash.dropRightWhile)(patches, function (patch) {
          return patch.id !== patchId;
        });
        if (patches.length === apply.length) return resolve();
        var data = { user: apply[apply.length - 1].user };
        apply.forEach(function (patch) {
          _fastJsonPatch2.default.apply(data, patch.ops, true);
        });
        console.log(data);
        _this.set(data).save().then(resolve).catch(reject);
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
    this._original = this.data();
  };
  schema.post('init', snapshot);
  schema.post('save', snapshot);

  // when a document is removed and `removePatches` is not set to false ,
  // all patch documents from the associated patch collection are also removed
  schema.pre('remove', function (next) {
    if (!options.removePatches) {
      return next();
    }

    var ref = this._id;

    this.patches.find({ ref: ref }).then(function (patches) {
      return (0, _bluebird.join)(patches.map(function (patch) {
        return patch.remove();
      }));
    }).then(next).catch(next);
  });

  // when a document is saved, the json patch that reflects the changes is
  // computed. if the patch consists of one or more operations (meaning the
  // document has changed), a new patch document reflecting the changes is
  // added to the associated patch collection
  schema.pre('save', function (next) {
    var _this2 = this;

    var ref = this._id;

    var ops = _fastJsonPatch2.default.compare(this.isNew ? {} : this._original, this.data());

    // don't save a patch when there are no changes to save
    if (!ops.length) {
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

var createPatchModel = function createPatchModel(options) {
  var def = {
    date: { type: Date, required: true, default: Date.now },
    ops: { type: [], required: true },
    ref: { type: _mongoose.Schema.Types.ObjectId, required: true, index: true }
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
};