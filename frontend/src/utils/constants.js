export const VIEWPORT_SIZES = {
  desktop: { width: 1280, height: 800, label: 'Desktop', icon: 'Monitor' },
  tablet: { width: 768, height: 1024, label: 'Tablet', icon: 'Tablet' },
  mobile: { width: 375, height: 667, label: 'Mobile', icon: 'Smartphone' },
};

export const TEMPLATE_PROJECTS = [
  {
    id: 'saas-dashboard',
    name: 'SaaS Dashboard',
    description: 'Modern analytics dashboard with charts, metrics, and data tables',
    icon: 'LayoutDashboard',
    prompt: 'Create a modern SaaS analytics dashboard with a sidebar navigation, top header with user profile, and main content area showing: KPI metric cards (revenue, users, growth, churn), a line chart for revenue trends, a bar chart for user signups, a recent transactions table, and a notifications panel. Use a professional dark theme with indigo accents.',
  },
  {
    id: 'ecommerce',
    name: 'E-Commerce Store',
    description: 'Online store with product listings, cart, and checkout',
    icon: 'ShoppingBag',
    prompt: 'Create a modern e-commerce storefront with: a hero banner with featured products, a product grid with cards showing image placeholders, price, rating, and add-to-cart buttons, category filters sidebar, search bar, shopping cart drawer, and a clean navigation header with logo, search, cart icon, and account. Use a clean modern design.',
  },
  {
    id: 'portfolio',
    name: 'Portfolio Website',
    description: 'Personal portfolio with projects showcase and contact',
    icon: 'User',
    prompt: 'Create a modern developer portfolio website with: hero section with name, title, and CTA buttons, about section with skills grid, projects showcase with project cards (image, title, description, tech tags, links), experience timeline, testimonials section, and contact form. Use smooth animations and a professional dark theme.',
  },
  {
    id: 'admin',
    name: 'Admin Panel',
    description: 'Administrative dashboard with user management and settings',
    icon: 'Settings',
    prompt: 'Create an admin panel with: collapsible sidebar navigation with icons, top bar with search and notifications, dashboard overview with stat cards and charts, user management table with search/filter/pagination, settings page with form sections, and role-based access indicators. Use a professional enterprise design.',
  },
  {
    id: 'landing',
    name: 'Landing Page',
    description: 'Marketing landing page with hero, features, and pricing',
    icon: 'Globe',
    prompt: 'Create a modern SaaS landing page with: sticky navigation bar, hero section with headline, subtext, CTA buttons and product screenshot placeholder, trusted-by logos section, features grid with icons, how-it-works steps, pricing table with 3 tiers, testimonials carousel, FAQ accordion, and footer with links. Use a modern design with gradients.',
  },
  {
    id: 'blog',
    name: 'Blog Platform',
    description: 'Blog with articles, categories, and reading experience',
    icon: 'BookOpen',
    prompt: 'Create a blog platform with: header with logo and navigation, featured article hero card, article grid with cards showing cover image placeholder, title, excerpt, author, date, and read time, category sidebar with tags, newsletter signup section, and article detail view with rich typography. Use a clean reading-focused design.',
  },
];

export const FILE_LANGUAGES = {
  jsx: 'javascript',
  js: 'javascript',
  css: 'css',
  json: 'json',
  html: 'html',
  md: 'markdown',
  txt: 'plaintext',
};
