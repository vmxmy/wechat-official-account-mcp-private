import { Section } from '@astryxdesign/core';
import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      <p className="page-description">{description}</p>
    </header>
  );
}

export function PageStack({ children }: { children: ReactNode }) {
  return <div className="page-stack">{children}</div>;
}

export function SurfaceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section className="surface-section" variant="section" padding={0}>
      <h2 className="section-heading">{title}</h2>
      {children}
    </Section>
  );
}

export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="definition-list">
      {items.map(item => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
