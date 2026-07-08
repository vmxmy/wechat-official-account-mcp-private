import { Grid, MetadataList, MetadataListItem, Section } from '@astryxdesign/core';
import type { GridColumns } from '@astryxdesign/core/Grid';
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

export function PageGrid({ children, columns }: { children: ReactNode; columns?: GridColumns }) {
  return (
    <Grid columns={columns ?? { minWidth: 320, max: 2 }} gap={4} align="start">
      {children}
    </Grid>
  );
}

export function SurfaceSection({ title, children, isFlush }: { title: string; children: ReactNode; isFlush?: boolean }) {
  return (
    <Section className={isFlush ? 'surface-section surface-section--flush' : 'surface-section'} variant="section" padding={0}>
      <h2 className="section-heading">{title}</h2>
      {children}
    </Section>
  );
}

export function DefinitionList({ items, columns }: { items: Array<{ label: string; value: ReactNode }>; columns?: 'single' | 'multi' }) {
  return (
    <MetadataList columns={columns ?? 'single'}>
      {items.map(item => (
        <MetadataListItem key={item.label} label={item.label}>
          {item.value}
        </MetadataListItem>
      ))}
    </MetadataList>
  );
}
