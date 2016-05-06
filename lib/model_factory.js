'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _mongoose = require('mongoose');

var _humps = require('humps');

exports.default = {
  patchModel: function patchModel(options) {
    var def = {
      date: { type: Date, required: true, default: Date.now },
      ops: { type: [], required: true },
      ref: { type: _mongoose.Schema.Types.ObjectId, required: true, index: true },
      user: { type: _mongoose.Schema.Types.ObjectId, required: true }
    };

    if (!options.referenceUser) {
      delete def.user;
    }

    var PatchSchema = new _mongoose.Schema(def);

    return options.mongoose.model((0, _humps.pascalize)('' + options.name), PatchSchema, (0, _humps.decamelize)('' + options.name));
  }
};