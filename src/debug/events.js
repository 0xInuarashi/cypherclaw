"use strict";
// debug/events.ts
// ----------------
// Typed events that flow through the provider agentic loop.
//
// Providers emit these events at key moments so that observers (like the
// chat-debug command) can log exactly what's happening inside the loop
// without the providers needing to know anything about how the events are
// displayed.
//
// Design: a simple callback (`DebugLogger`) rather than an EventEmitter.
// This is intentionally minimal — no dependency needed, easy to test, and
// the synchronous callback model is fine since logging is fire-and-forget.
Object.defineProperty(exports, "__esModule", { value: true });
