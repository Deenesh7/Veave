// Single source of truth for the brand, navigation and footer. Navbar and Footer read from here.
export const site = {
  name: 'Nimbus',
  tagline: 'Software that keeps your team moving. Plan, ship and measure in one place.',
  email: 'hello@nimbus.example',
  nav: [
    {
      label: 'Home',
      to: '/'
    },
    {
      label: 'Features',
      to: '/features'
    },
    {
      label: 'Pricing',
      to: '/pricing'
    },
    {
      label: 'Contact',
      to: '/contact'
    }
  ],
  cta: {
    label: 'Start free trial',
    to: '/contact'
  },
  footerGroups: [
    {
      title: 'Product',
      links: [
        {
          label: 'Features',
          to: '/features'
        },
        {
          label: 'Pricing',
          to: '/pricing'
        }
      ]
    },
    {
      title: 'Company',
      links: [
        {
          label: 'Home',
          to: '/'
        },
        {
          label: 'Contact',
          to: '/contact'
        }
      ]
    }
  ]
};

export default site;
