// Single source of truth for the brand, navigation and footer. Navbar and Footer read from here.
export const site = {
  name: 'Lena Hart',
  tagline: 'Independent designer and developer crafting calm, considered digital experiences.',
  email: 'hello@lenahart.example',
  nav: [
    {
      label: 'Home',
      to: '/'
    },
    {
      label: 'Work',
      to: '/work'
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
    label: 'Hire me',
    to: '/contact'
  },
  footerGroups: [
    {
      title: 'Explore',
      links: [
        {
          label: 'Work',
          to: '/work'
        },
        {
          label: 'About',
          to: '/about'
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
