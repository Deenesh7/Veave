/**
 * Is a one-page instruction a normal edit ("make the hero heading larger") or a request to turn the website into another kind of
 * website ("make this page for a college website")? A cheap text gate decides whether it is worth asking the planner; the planner
 * (the same model call that plans a whole website) then decides what the website is. No industry is named here: any category works.
 */
const CHANGE = /\b(make|turn|convert|transform|change|adapt|rewrite|redo|rebuild|recreate|build|create|design|use|set up|setup)\b/i;
const TARGET = /\b(for|into|as|to be|to become|about)\s+(?:a|an|the|my|our)?\s*[\p{L}][\p{L}\s&'-]{1,60}?\b(website|web site|site|page|school|college|university|institute|institution|academy|hospital|clinic|company|business|shop|store|restaurant|hotel|organi[sz]ation|ngo|charity|firm|agency|startup|app|portfolio|event|church|gym|salon)\b/iu;
const DIRECT = /\b(?:make|turn|convert|transform)\s+(?:this|the|my)\s+(?:website|web site|site|page|template)?\s*(?:into\s+)?(?:a|an)\s+[\p{L}][\p{L}\s&'-]{1,40}?\s+(?:website|web site|site|page)\b/iu;
const WEBSITE_WORD = /\b(website|web site|whole site|entire site|this site|the site)\b/i;
// Edits that only touch how something looks or a single element are never a change of subject.
const SMALL_EDIT = /\b(larger|smaller|bigger|font|typeface|colou?rs?|bold|italic|margin|padding|spacing|align(?:ed|ment)?|rounded|shadow|border|height|width|heading size|text size|hero (?:heading|title|image|photo|text)|add (?:a|an|the|another)|remove|delete|move|swap|reorder|shorten|lengthen|fix|typo|spelling|replace the (?:hero )?(?:image|photo|picture)|change the (?:hero )?(?:image|photo|picture|colou?r|font))\b/i;

function mayChangeCategory(instruction) {
  const text = String(instruction || '').trim();
  if (text.length < 8) return false;
  if (!CHANGE.test(text)) return false;
  const aimed = TARGET.test(text) || DIRECT.test(text) || (WEBSITE_WORD.test(text) && /\b(for|into|as)\b/i.test(text));
  if (!aimed) return false;
  // "Make the hero heading larger for mobile" is a small edit even though it contains "for".
  if (SMALL_EDIT.test(text) && !/\b(website|web site|site)\b/i.test(text.replace(/\b(this|the) (?:page|section)\b/gi, ''))) return false;
  return true;
}

const words = (text) => String(text || '').toLowerCase().match(/[a-z]{3,}/g) || [];
const GENERIC = new Set(['the', 'and', 'website', 'site', 'page', 'for', 'institution', 'organisation', 'organization', 'company']);
/** Two category names ("College", "Higher education / college") describe the same kind of website when they share a meaningful word. */
function sameCategory(a, b) {
  const x = new Set(words(a).filter((word) => !GENERIC.has(word)));
  return words(b).filter((word) => !GENERIC.has(word)).some((word) => x.has(word));
}

module.exports = { mayChangeCategory, sameCategory };
