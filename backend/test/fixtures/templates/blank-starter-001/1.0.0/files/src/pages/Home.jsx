import React from 'react';
import Section, { SectionHeading } from '../components/Section';

export default function Home() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Blank website"
        title="Your website starts here"
        description="This is an empty starting point with a header, a footer and a clean design system. Describe the website you want and every page, menu entry and section is written for it, in the colours and fonts you chose."
        align="center"
      />
    </Section>
  );
}
