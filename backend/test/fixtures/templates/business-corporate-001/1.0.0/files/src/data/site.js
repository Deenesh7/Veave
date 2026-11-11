// Single source of truth for the brand, navigation and footer. Navbar and Footer read from here.
export const site = {
  name: 'Meridian Group',
  tagline: 'Practical advice and dependable delivery for growing businesses.',
  email: 'info@meridian.example',
  nav: [
    {
      label: 'Home',
      to: '/'
    },
    {
      label: 'Services',
      to: '/services'
    },
    {
      label: 'About',
      to: '/about'
    },
    {
      label: 'Contact',
      to: '/contact'
    }
  ],
  cta: {
    label: 'Request a consultation',
    to: '/contact'
  },
  footerGroups: [
    {
      title: 'Company',
      links: [
        {
          label: 'About',
          to: '/about'
        },
        {
          label: 'Contact',
          to: '/contact'
        }
      ]
    },
    {
      title: 'Services',
      links: [
        {
          label: 'Services',
          to: '/services'
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
