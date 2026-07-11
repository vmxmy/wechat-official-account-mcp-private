import { Grid, Heading, MetadataList, MetadataListItem, Section, Text, VStack } from '@astryxdesign/core';
import type { GridColumns } from '@astryxdesign/core/Grid';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <header className="page-header">
      <VStack className="page-header-copy" gap={2}>
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <Heading level={1} type="display-3" textWrap="balance">{title}</Heading>
        <Text type="supporting" as="p" textWrap="pretty">{description}</Text>
      </VStack>
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

export function SurfaceSection({
  title,
  children,
  tone = 'default',
  className,
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'accent' | 'quiet';
  className?: string;
}) {
  const sectionClassName = ['surface-section', `surface-section--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  const sectionVariant = tone === 'quiet' ? 'muted' : 'section';

  return (
    <Section className={sectionClassName} variant={sectionVariant} padding={5} data-tone={tone}>
      <VStack gap={4}>
        <div className="surface-section-heading">
          <span className="surface-section-marker" aria-hidden="true" />
          <Heading level={2}>{title}</Heading>
        </div>
        {children}
      </VStack>
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
