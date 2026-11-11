// Single source of truth for the brand, navigation and footer. Navbar and Footer read from here.
export const site = {
  name: 'My Website',
  tagline: 'A new website, ready to be designed.',
  email: 'info@example.com',
  nav: [
    { label: 'Home', to: '/' }
  ],
  cta: null,
  footerGroups: [
    {
      title: 'Explore',
      links: [
        { label: 'Home', to: '/' }
      ]
    }
  ]
};

export default site;
