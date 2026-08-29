'use strict';

const OPENROUTER_FREE_PRIMARY_MODEL = 'google/gemma-4-26b-a4b-it:free';
// `openrouter/free` is OpenRouter's Free Models Router: it selects among the free
// models that are actually available at call time, rather than pinning an id that
// can be delisted. That is the point here — the previous value,
// 'openai/gpt-oss-20b:free', HAS been delisted (verified 2026-08-29 against
// https://openrouter.ai/api/v1/models: only the paid 'openai/gpt-oss-20b' remains),
// so this backup leg was dead. A router cannot rot the same way.
//
// Deliberately the BACKUP and not the primary: it picks a different model per call,
// which is fine for a last-resort leg and wrong for anything whose output must be
// reproducible. It declares both response_format and structured_outputs, so a
// JSON-shaped request is still enforced rather than silently dropped.
const OPENROUTER_FREE_BACKUP_MODEL = 'openrouter/free';
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';
const OPENROUTER_PROVIDER_ROUTING = {
  ignore: ['baidu', 'alibaba', 'deepseek', 'siliconflow', 'streamlake', 'novita'],
  sort: 'throughput',
};

module.exports = {
  GROQ_DEFAULT_MODEL,
  OPENROUTER_FREE_BACKUP_MODEL,
  OPENROUTER_FREE_PRIMARY_MODEL,
  OPENROUTER_PROVIDER_ROUTING,
};
