/**
 * SCREENSHOT-TO-UI FEATURE WORKFLOW PROMPT
 * Defines the end-to-end workflow instruction for Screenshot Upload / Screenshot-to-Website feature.
 */

const SCREENSHOT_TO_UI_FEATURE_PROMPT = `SCREENSHOT-TO-UI FEATURE

Create a Screenshot-to-UI generation feature that allows the user to upload one or more screenshots and generate a functional website that closely reproduces the uploaded design.

When a screenshot is uploaded:

1. Send the screenshot to a vision-capable model for analysis.

2. Analyze the screenshot and identify:
   - Overall page structure
   - Layout and grid system
   - Header and navigation
   - Sidebar
   - Content sections
   - Cards
   - Buttons
   - Forms
   - Tables
   - Images
   - Icons
   - Typography
   - Colors
   - Gradients
   - Borders
   - Border radius
   - Shadows
   - Spacing
   - Alignment
   - Widths and heights
   - Responsive relationships
   - Visible interactive elements

3. Convert the visual analysis into a structured UI specification.

4. Combine the screenshot analysis with:
   - The user's text prompt
   - The existing project structure
   - The existing design system
   - Existing reusable components
   - Existing assets

5. Generate the website using the project's required technology stack.

6. Recreate the screenshot using actual UI components and code.
   Do NOT use the screenshot itself as the website background.
   Do NOT simply place the screenshot inside an image element.

7. Preserve the visual hierarchy and proportions of the reference screenshot.

8. If the screenshot contains functionality that can reasonably be inferred from the UI, implement the corresponding interaction.

9. Render the generated website and compare it against the reference screenshot.

10. Identify visual differences such as:
    - Incorrect spacing
    - Incorrect sizing
    - Incorrect typography
    - Incorrect colors
    - Incorrect alignment
    - Missing components
    - Incorrect image proportions
    - Incorrect responsive behavior

11. Refine the generated code based on those differences.

12. Repeat the visual refinement process until the generated UI closely matches the reference screenshot.

The goal is not to create a similar website.

The goal is to reproduce the visual structure and design of the uploaded screenshot while producing a real, functional, maintainable website.`;

const getScreenshotFeatureInstructions = (userPrompt = '', designSystem = 'Modern') => {
  return `${SCREENSHOT_TO_UI_FEATURE_PROMPT}

USER INSTRUCTION:
"${userPrompt || 'Recreate screenshot layout with clean React and Tailwind'}"

DESIGN SYSTEM / TOKENS CONTEXT:
${designSystem}

Please perform the visual analysis and synthesize the complete, production-ready React component code.`;
};

module.exports = {
  SCREENSHOT_TO_UI_FEATURE_PROMPT,
  getScreenshotFeatureInstructions
};
