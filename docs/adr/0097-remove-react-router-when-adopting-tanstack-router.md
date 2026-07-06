# Remove React Router when adopting TanStack Router

The Web entrypoint will not keep React Router and TanStack Router side by side. When TanStack Router is introduced, React Router dependencies and router code should be removed to avoid duplicate navigation models and LinkProvider ambiguity.
