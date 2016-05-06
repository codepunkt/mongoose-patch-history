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
      transform: function transform(doc, ret, options) {
        delete ret._id;
      }
    });
  };

  // create patch model, enable static model access via `PatchModel` and
  // instance method access through an instances `patches` property
  var PatchModel = createPatchModel(options);
  schema.statics.PatchModel = PatchModel;
  schema.virtual('patches').get(function () {
    return PatchModel;
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
    var _this = this;

    var ref = this._id;

    var ops = (0, _fastJsonPatch.compare)(this.isNew ? {} : this._original, this.data());

    // don't save a patch when there are no changes to save
    if (!ops.length) {
      return next();
    }

    // assemble patch data
    var data = { ops: ops, ref: ref };
    (0, _lodash.each)(options.includes, function (type, name) {
      data[name] = _this[type.from || name];
    });

    PatchModel.create(data).then(next).catch(next);
  });
};

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

var _bluebird = require('bluebird');

var _mongoose = require('mongoose');

var _fastJsonPatch = require('fast-json-patch');

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