"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Process-level chat task queue.
 *
 * Although located in channel/, this module is intentionally shared
 * across channel, messaging, tools, and card layers as a process-level
 * singleton. Consumers: monitor.ts, dispatch.ts, oauth.ts, auto-auth.ts.
 *
 * Ensures tasks targeting the same account+chat are executed serially.
 * Used by both websocket inbound messages and synthetic message paths.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const time_runtime_1 = require("openclaw/plugin-sdk/time-runtime");
exports.threadScopedKey = threadScopedKey;
exports.buildQueueKey = buildQueueKey;
exports.registerActiveDispatcher = registerActiveDispatcher;
exports.unregisterActiveDispatcher = unregisterActiveDispatcher;
exports.getActiveDispatcher = getActiveDispatcher;
exports.hasActiveTask = hasActiveTask;
exports.enqueueFeishuChatTask = enqueueFeishuChatTask;
exports._resetChatQueueState = _resetChatQueueState;
/**
 * Per-task cap. A hung dispatch must not block later messages in the same
 * chat forever: once a task exceeds this cap it keeps running, but the queue
 * chain advances so newer same-key work can proceed (#70133). Set
 * `taskTimeoutMs: 0` on the enqueue call to restore unbounded FIFO.
 */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
/** Node's setTimeout ceiling; larger finite values would clamp to 1ms. */
const MAX_TIMER_TIMEOUT_MS = 2147483647;
const chatQueues = new Map();
const activeDispatchers = new Map();
/**
 * Append `:thread:{threadId}` suffix when threadId is present.
 * Consistent with the SDK's `:thread:` separator convention.
 */
function threadScopedKey(base, threadId) {
    return threadId ? `${base}:thread:${threadId}` : base;
}
function buildQueueKey(accountId, chatId, threadId) {
    return threadScopedKey(`${accountId}:${chatId}`, threadId);
}
function registerActiveDispatcher(key, entry) {
    activeDispatchers.set(key, entry);
}
function unregisterActiveDispatcher(key) {
    activeDispatchers.delete(key);
}
function getActiveDispatcher(key) {
    return activeDispatchers.get(key);
}
/** Check whether the queue has an active task for the given key. */
function hasActiveTask(key) {
    return chatQueues.has(key);
}
/**
 * Run a queued task under a timeout guard.
 *
 * The task itself is never cancelled -- on timeout the guard simply stops
 * awaiting it, so the parent queue chain can advance. This trades strict
 * ordering for liveness on the pathological case only.
 */
async function boundedRun(key, task, taskTimeoutMs, onTaskTimeout) {
    const timeoutMs = Math.min(taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS, MAX_TIMER_TIMEOUT_MS);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return task();
    }
    return (0, time_runtime_1.raceWithTimeout)(task, timeoutMs, () => {
        try {
            onTaskTimeout?.(key, timeoutMs);
        }
        catch {
            // Logging/callbacks must never poison the queue chain.
        }
    });
}
function enqueueFeishuChatTask(params) {
    const { accountId, chatId, threadId, task, taskTimeoutMs, onTaskTimeout } = params;
    const key = buildQueueKey(accountId, chatId, threadId);
    const prev = chatQueues.get(key) ?? Promise.resolve();
    const status = chatQueues.has(key) ? 'queued' : 'immediate';
    const wrapped = () => boundedRun(key, task, taskTimeoutMs, onTaskTimeout);
    const taskPromise = prev.then(wrapped, wrapped);
    chatQueues.set(key, taskPromise);
    const cleanup = () => {
        if (chatQueues.get(key) === taskPromise) {
            chatQueues.delete(key);
        }
    };
    taskPromise.then(cleanup, cleanup);
    return { status, promise: taskPromise };
}
/** @internal Test-only: reset all queue and dispatcher state. */
function _resetChatQueueState() {
    chatQueues.clear();
    activeDispatchers.clear();
}
