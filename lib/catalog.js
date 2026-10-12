// The specialist catalog: Claude Code skills you can hire into the crew as on-call agents.
// Each entry becomes an agent on a floor, its skills go into the playbook, and the plugin that
// carries the skills is installed into Claude Code (claude plugin install). Curated from Anthropic's
// official skills (github.com/anthropics/skills) and the most-used community packs. Add your own
// with a plugin or a PR: { id, name, title, floor, summary, use, skills:[{name, does}], source, install }.
'use strict';

const ANTHROPIC = { marketplace: 'anthropics/skills', marketplaceName: 'anthropic-agent-skills' };
const docs = { ...ANTHROPIC, plugin: 'document-skills@anthropic-agent-skills' };
const examples = { ...ANTHROPIC, plugin: 'example-skills@anthropic-agent-skills' };
const superpowers = { marketplace: 'obra/superpowers-marketplace', marketplaceName: 'superpowers-marketplace', plugin: 'superpowers@superpowers-marketplace' };

const CATALOG = [
  // marketing
  { id: 'designer', name: 'designer', title: 'Designer', floor: 'marketing', source: 'Anthropic (official)', install: examples,
    summary: 'Distinctive, non-generic front ends, landing pages, posters and brand-consistent visuals.',
    use: 'Landing pages, UI polish, social visuals, on-brand assets for any project.',
    skills: [{ name: 'frontend-design', does: 'bold, production-grade UI that avoids the generic AI look' }, { name: 'canvas-design', does: 'posters and visual art as PNG/PDF' }, { name: 'brand-guidelines', does: 'apply a brand\'s colours and type' }, { name: 'theme-factory', does: 'consistent themes for decks, docs and pages' }] },
  { id: 'writer', name: 'writer', title: 'Content writer', floor: 'marketing', source: 'Anthropic (official)', install: examples,
    summary: 'Launch posts, newsletters, announcements and long-form docs, co-written with you.',
    use: 'Launch copy, release notes, newsletters, investor updates.',
    skills: [{ name: 'doc-coauthoring', does: 'structured co-writing of specs, proposals and docs' }, { name: 'internal-comms', does: 'status reports, updates, FAQs, newsletters' }] },
  // back office
  { id: 'docs', name: 'docs-specialist', title: 'Document specialist', floor: 'backoffice', source: 'Anthropic (official)', install: docs,
    summary: 'Creates and edits real files: Word documents, PDFs, PowerPoint decks and Excel sheets.',
    use: 'Proposals, contracts, decks, filled-in PDF forms, reports as files.',
    skills: [{ name: 'docx', does: 'Word documents with tracked changes, comments, formatting' }, { name: 'pdf', does: 'read, fill, merge, split and create PDFs' }, { name: 'pptx', does: 'PowerPoint decks from scratch or templates' }, { name: 'xlsx', does: 'spreadsheets with formulas, formatting and charts' }] },
  { id: 'skillsmith', name: 'skillsmith', title: 'Skill smith', floor: 'backoffice', source: 'Anthropic (official)', install: examples,
    summary: 'Turns what the crew figured out into reusable Claude skills, and tests them.',
    use: 'After a task went well: "make that a skill" for every agent and project.',
    skills: [{ name: 'skill-creator', does: 'create, improve and evaluate skills' }] },
  // finance
  { id: 'analyst', name: 'finance-analyst', title: 'Finance analyst', floor: 'finance', source: 'Anthropic (official)', install: docs,
    summary: 'Spreadsheets and documents for money: models, invoices, reconciliations, reports.',
    use: 'Monthly close, pricing models, invoice batches, cost overviews per project.',
    skills: [{ name: 'xlsx', does: 'financial models and reconciliations with live formulas' }, { name: 'pdf', does: 'read invoices and statements, produce PDF reports' }] },
  // tech
  { id: 'qa', name: 'qa-tester', title: 'QA tester', floor: 'tech', source: 'Anthropic (official)', install: examples,
    summary: 'Tests web apps in a real browser with Playwright: flows, screenshots, logs.',
    use: 'Before a deploy: "click through checkout on staging and report what breaks".',
    skills: [{ name: 'webapp-testing', does: 'Playwright testing of local web apps, with screenshots and logs' }] },
  { id: 'engineer', name: 'senior-engineer', title: 'Senior engineer', floor: 'tech', source: 'Community: Superpowers (obra)', install: superpowers,
    summary: 'A disciplined way of working: brainstorm, plan, test-driven build, systematic debugging, review.',
    use: 'Hard features and nasty bugs on any repo.',
    skills: [{ name: 'brainstorming', does: 'shape the idea before coding' }, { name: 'writing-plans', does: 'step-by-step implementation plans' }, { name: 'test-driven-development', does: 'red, green, refactor' }, { name: 'systematic-debugging', does: 'find root causes, not symptoms' }, { name: 'requesting-code-review', does: 'review before merge' }] },
  // external
  { id: 'integrator', name: 'integrations', title: 'Integrations engineer', floor: 'external', source: 'Anthropic (official)', install: examples,
    summary: 'Builds MCP servers so agents can use outside services and APIs well.',
    use: 'Connect a new API, SaaS or internal tool to the whole crew.',
    skills: [{ name: 'mcp-builder', does: 'design and build high-quality MCP servers' }] },
];

const find = id => CATALOG.find(c => c.id === id || c.name === id);

module.exports = { CATALOG, find };
