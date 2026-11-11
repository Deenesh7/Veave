// Single source of truth for the brand, navigation and footer. Navbar and Footer read from here.
export const site = {
  name: 'Ember House',
  tagline: 'An architecture and interiors studio designing quiet, honest houses from natural materials.',
  email: 'hello@emberhouse.example',
  nav: [
    {
      label: 'Home',
      to: '/'
    },
    {
      label: 'Studio',
      to: '/studio'
    },
    {
      label: 'Projects',
      to: '/projects'
    },
    {
      label: 'Contact',
      to: '/contact'
    }
  ],
  cta: {
    label: 'Start a project',
    to: '/contact'
  },
  footerGroups: [
    {
      title: 'Explore',
      links: [
        {
          label: 'Studio',
          to: '/studio'
        },
        {
          label: 'Projects',
          to: '/projects'
        }
      ]
    },
    {
      title: 'Connect',
      links: [
        {
          label: 'Contact',
          to: '/contact'
        },
        {
          label: 'Home',
          to: '/'
        }
      ]
    }
  ]
};

export default site;
