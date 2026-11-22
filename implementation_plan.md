# Implementation Plan — Modern AI Settings & Provider Management Panels

Modernize the UI/UX for AI Settings, Model Providers, and Slot Assignment panels with a rich, glassmorphic, and intuitive interface.

## User Review Required

> [!NOTE]
> All security invariants and backend API contracts (`/api/providers`, `/api/providers/test`, `/api/providers/select`, masked keys, independent slot selections) will be 100% preserved.

## Proposed Changes

### 1. Unified Modern Provider Settings (`features/conversation/ProviderSelector.tsx`)
- **Glassmorphic Modal Shell**: Frosted backdrop blur, luminous border, subtle shadows, and header with AI sparkle badge and live provider count.
- **Top Tab Bar**: 
  - 🎛️ **"Model Providers"**: Visual card grid of configured providers with live verification badges (green pulsing dot, amber untested, red failed), endpoint URL, masked key status, model discovery tags, inline connection tester, edit & delete buttons.
  - 🎯 **"Role Assignments"**: Dedicated role cards for **Chat Copilot**, **BIM Extraction Engine**, and **3D Rendering** with provider/model dropdowns and active indicators.
  - ➕ **"Add Provider"**: Fast-action button to open the configuration workflow.
- **Add / Edit Provider Form (`ProviderForm`)**:
  - **Quick Presets**: 1-click preset pills for *Google Gemini*, *OpenAI*, *OpenRouter*, *Groq*, and *Local Ollama*.
  - **Secure Key Input**: Lock icon, eye toggle (`Show/Hide`), masked preview, and security reassurance note.
  - **Model Discovery Engine**: "↻ Discover Models from API Key" with spinning icon, dynamic model badge count, and clickable model tags for instant selection.
  - **Capability Tags**: Interactive styled pills with icons (`Chat`, `Vision`, `BIM Extraction`, `Rendering`, `Editing`).
  - **Live Connection Feedback**: Visual status box showing verification outcome and discovery summary.

### 2. Sleek Inline Controls (`features/ai-extraction/components/AiExtractionControls.tsx`)
- Modernized inline extraction model selector in the chat composer with glowing provider glyph, frosted glass dropdown, and styled settings gear icon with hover animation.

### 3. Global CSS Polish (`src/app/globals.css`)
- Design system tokens and styles for `.db-provider-card`, `.db-tab-bar`, `.db-preset-pill`, `.db-role-card`, `.db-status-pill`, and glassmorphic dialog enhancements.

---

## Verification Plan

### Automated Tests
- Run provider UI submission integration tests:
  ```powershell
  pnpm --filter design-build-editor exec vitest run tests/provider-ui-submission.test.ts
  ```
- Typecheck editor app:
  ```powershell
  pnpm --filter design-build-editor typecheck
  ```

### Manual Verification
- Open [http://localhost:3003](http://localhost:3003) and click "Settings" or the gear icon.
- Verify the modern glassmorphic modal, tab switching, and provider cards.
- Test adding a provider with presets, entering credentials, refreshing models, testing connection, and saving.
- Test assigning models to Chat, Extraction, and Render slots.
