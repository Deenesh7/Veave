const axios = require('axios');
const logger = require('../../utils/logger');
const { AIError } = require('../../utils/errors');
const { UI_GENERATION_SYSTEM_PROMPT, SCREENSHOT_TO_UI_FEATURE_PROMPT } = require('./prompts/systemPrompt');

class GeminiService {
  async repairProject(prompt, imageInput = null) {
    const url = `${this.baseURL}/models/${this.getEffectiveModel()}:generateContent`;
    const { data } = await axios.post(url, {
      systemInstruction: { parts: [{ text: 'You repair project files minimally from real diagnostics. Return strict JSON with a files array. Preserve all unrelated functionality and exports.' }] },
      contents: [{ role: 'user', parts: [
        ...(imageInput ? (() => {
          const match = imageInput.match(/^data:([^;]+);base64,(.+)$/);
          return match ? [{ inlineData: { mimeType: match[1], data: match[2] } }] : [];
        })() : []),
        { text: prompt }
      ] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: 'application/json' }
    }, { headers: { 'x-goog-api-key': this.getEffectiveKey() }, timeout: 120000 });
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Repair response was truncated by the model.');
    return (candidate?.content?.parts || []).map((part) => part.text || '').join('\n');
  }
  constructor() {
    this.apiKey = process.env.GEMINI_FLASH_API_KEY || process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_FLASH_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-3.8';
    this.baseURL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  }

  isConfigured() {
    const key = process.env.GEMINI_FLASH_API_KEY || process.env.GEMINI_API_KEY || this.apiKey;
    return Boolean(
      key && 
      key.trim() !== '' && 
      key !== 'your_gemini_flash_api_key' && 
      key !== 'your_gemini_api_key'
    );
  }

  getEffectiveKey() {
    return (process.env.GEMINI_FLASH_API_KEY || process.env.GEMINI_API_KEY || this.apiKey || '').trim();
  }

  getEffectiveModel() {
    return (process.env.GEMINI_FLASH_MODEL || process.env.GEMINI_MODEL || this.model || 'gemini-flash-3.8').trim();
  }

  /**
   * Directly synthesize React component with Google Gemini Flash 3.8
   */
  async generateReactCode(prompt, systemTokens = {}) {
    if (!this.isConfigured()) {
      throw new AIError('Gemini Flash API key is not configured');
    }

    const key = this.getEffectiveKey();
    const model = this.getEffectiveModel();
    const url = `${this.baseURL}/models/${model}:generateContent?key=${key}`;

    const systemInstruction = `You are an expert React engineer and UI designer.
Generate a high-fidelity, production-ready, interactive React functional component using Tailwind CSS and Lucide React icons.
This code will be built and executed in an isolated browser. Use local assets or inline SVG and system font stacks, not external image URLs, CDN scripts or web-font requests. Do not fake API integration; missing external APIs must be stated rather than replaced silently.
Primary brand color: ${systemTokens.primary || '#3B9FE8'}.
Background: ${systemTokens.bg || '#F8F9FA'}.
Card radius: ${systemTokens.radius || '16px'}.
Do not mention "database" or "MongoDB".
CRITICAL BOTTOM PAGE NAVIGATION & "ADD MORE PAGE" REQUIREMENT:
- At the bottom of the main content (above the footer), you MUST include an interactive multi-page navigation bar.
- It must display available pages as tabs/buttons (e.g., "Page 1: Overview", "Page 2: Details") AND a prominent "+ Add More Page" (or "Add Page") button.
- It MUST ACTUALLY WORK using React useState: maintain a "pages" array (e.g. const [pages, setPages] = useState([...])) and active page state.
- When the user clicks "+ Add More Page", it adds a new page to state, switches to that page, and renders content for the new page dynamically!
CRITICAL SYNTAX & FORMAT REQUIREMENTS:
- Use standard JavaScript and React JSX only. Do NOT use TypeScript. Do NOT use "interface", "type", or type annotations.
- Always use proper template strings with backticks for dynamic class names: className={\`px-4 py-2 \${active ? 'bg-indigo-600' : 'text-zinc-400'}\`}. Never omit backticks!
- Ensure all ternary operators and function calls are complete and syntactically valid.
- Return ONLY valid, executable React code starting with standard imports and "export default function App()". Do not add markdown or extra conversational text.`;

    const userPrompt = `Build an interactive, modern React application for: "${prompt}".
Include realistic UI components, states with useState, realistic domain items without generic mock placeholders, clean responsive layout with Tailwind CSS, Lucide React icons, and at the bottom include a functional multi-page navigation bar with a working "+ Add More Page" button that creates new pages dynamically.`;

    try {
      const { data } = await axios.post(url, {
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      });

      const rawContent = (data.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n');

      if (!rawContent) {
        throw new Error('Empty response received from Gemini Flash API');
      }

      const cleanCode = rawContent
        .replace(/```(jsx|javascript|react)?/gi, '')
        .replace(/```/g, '')
        .trim();

      return {
        code: cleanCode,
        usage: {
          prompt: data.usageMetadata?.promptTokenCount || 0,
          completion: data.usageMetadata?.candidatesTokenCount || 0,
          total: data.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      logger.error(`Direct Gemini Flash API Error: ${msg}`);
      throw new AIError(`Gemini Flash Error: ${msg}`);
    }
  }

  /**
   * Synthesize React component from uploaded screenshot using Google Gemini Vision (Multimodal)
   */
  async generateReactCodeFromScreenshot(imageInput, userPrompt = '', systemTokens = {}) {
    if (!this.isConfigured()) {
      throw new AIError('Gemini Flash API key is not configured');
    }

    const key = this.getEffectiveKey();
    const model = this.getEffectiveModel();
    const url = `${this.baseURL}/models/${model}:generateContent?key=${key}`;

    let mimeType = 'image/png';
    let base64Data = imageInput;

    if (imageInput.startsWith('data:')) {
      const match = imageInput.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    const systemInstruction = `${UI_GENERATION_SYSTEM_PROMPT}

CRITICAL SYNTAX, INTERACTION & FORMAT REQUIREMENTS:
- Use standard JavaScript and React JSX only. Do NOT use TypeScript. Do NOT use "interface", "type", or type annotations.
- ZERO PURPLE COLOR: Do NOT use purple, violet, lavender, or fuchsia anywhere in the generated code (no purple-* or violet-* Tailwind classes, no purple hex codes). Use clean blues, cyans, emeralds, teals, or neutral slates.
- INTERACTIVE UI & RUNTIME SAFETY: Every interactive element (navbar links, dropdowns, buttons, tabs, sidebars, modals, forms, search controls, cards) must have a functional, safe event handler or state transition. Never call undefined functions, pass unresolved arguments, or render plain objects as React children.
- Always use proper template strings with backticks for dynamic class names: className={\`px-4 py-2 \${active ? 'bg-indigo-600' : 'text-zinc-400'}\`}. Never omit backticks!
- Ensure all ternary operators and function calls are complete and syntactically valid.
- Return ONLY valid, executable React code starting with standard imports and "export default function App()". Do not add markdown or extra conversational text.`;

    const workflowPrompt = `${SCREENSHOT_TO_UI_FEATURE_PROMPT}

USER SPECIFICATION:
"${userPrompt || 'Analyze this screenshot and recreate the visual structure, layout, typography, colors, and components as a functional React component.'}"

EXISTING DESIGN SYSTEM & TOKENS:
- Primary Color: ${systemTokens.primary || '#3B9FE8'}
- Secondary: ${systemTokens.secondary || '#64748B'}
- Background: ${systemTokens.bg || '#F8F9FA'}
- Card Background: ${systemTokens.card || '#FFFFFF'}
- Border Radius: ${systemTokens.radius || '16px'}
- Font: ${systemTokens.font || 'Inter, system-ui, sans-serif'}

Execute the Screenshot-to-UI feature workflow:
Analyze page structure, layout system, component hierarchy, spacing, typography, colors, borders, shadows, and interactive states.
Recreate the screenshot using actual React UI components with Tailwind CSS and Lucide React icons.
Do NOT use the screenshot itself as a background or place it in an <img> tag.
Return ONLY valid React code with "export default function App()".`;

    try {
      const { data } = await axios.post(url, {
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              },
              {
                text: workflowPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      });

      const rawContent = (data.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n');

      if (!rawContent) {
        throw new Error('Empty response received from Gemini Flash Vision API');
      }

      const cleanCode = rawContent
        .replace(/```(jsx|javascript|react)?/gi, '')
        .replace(/```/g, '')
        .trim();

      return {
        code: cleanCode,
        usage: {
          prompt: data.usageMetadata?.promptTokenCount || 0,
          completion: data.usageMetadata?.candidatesTokenCount || 0,
          total: data.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      logger.error(`Direct Gemini Flash Vision Error: ${msg}`);
      throw new AIError(`Gemini Flash Vision Error: ${msg}`);
    }
  }

  /**
   * Directly modify React component with Google Gemini Flash 3.8
   */
  async modifyReactCode(currentCode, modificationPrompt, systemTokens = {}) {
    if (!this.isConfigured()) {
      throw new AIError('Gemini Flash API key is not configured');
    }

    const key = this.getEffectiveKey();
    const model = this.getEffectiveModel();
    const url = `${this.baseURL}/models/${model}:generateContent?key=${key}`;

    const systemInstruction = `You are a surgical React code editor.
Modify the user's current React source file according to their instruction while preserving the overall design, Tailwind CSS styling, lucide-react icons, component names, and module exports.
CRITICAL FORMAT RULES:
- Use standard JavaScript and React JSX only. Do NOT use TypeScript.
- Always use proper template literal backticks for dynamic strings: className={\`px-4 \${active ? 'bg-black' : ''}\`}.
- Preserve the file's current default and named export shape. Do not rename components or add/remove exports unless required to fix the reported issue.
- Return ONLY the complete updated file contents. Do not truncate or summarize the file.`;

    const userPrompt = `Given this current React code:
${currentCode.slice(0, 30000)}

Apply this modification instruction: "${modificationPrompt}".`;

    try {
      const { data } = await axios.post(url, {
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      });

      const rawContent = (data.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n');

      const cleanCode = rawContent
        .replace(/```(jsx|javascript|react)?/gi, '')
        .replace(/```/g, '')
        .trim();

      return {
        code: cleanCode,
        usage: {
          total: data.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      logger.error(`Direct Gemini Flash Modify Error: ${msg}`);
      throw new AIError(`Gemini Flash Modify Error: ${msg}`);
    }
  }
}

module.exports = new GeminiService();
