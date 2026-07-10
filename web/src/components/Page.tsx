import { Grid, Heading, MetadataList, MetadataListItem, Section, Text, VStack } from '@astryxdesign/core';
import type { GridColumns } from '@astryxdesign/core/Grid';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <VStack className="page-header-copy" gap={2}>
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

export function SurfaceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section className="surface-section" variant="transparent" padding={5}>
      <VStack gap={4}>
        <Heading level={2}>{title}</Heading>
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
