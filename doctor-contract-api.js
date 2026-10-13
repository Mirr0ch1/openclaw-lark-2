"use strict";
/**
 * Doctor contract entry resolved by the host from the package root
 * (`doctor-contract-api.js`) so `openclaw doctor --fix` can repair legacy
 * `channels.feishu` config before schema validation rejects it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const doctor_contract_1 = require("./src/core/doctor-contract.js");
exports.legacyConfigRules = doctor_contract_1.legacyConfigRules;
exports.normalizeCompatibilityConfig = doctor_contract_1.normalizeCompatibilityConfig;
