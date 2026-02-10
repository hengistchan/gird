interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export function Loading({ size = 'md', text }: LoadingProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-4',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <div
        className={`${sizeClasses[size]} border-gray-200 border-t-blue-600 rounded-full animate-spin`}
        role="status"
        aria-label="Loading"
      />
      {text && <p className="mt-4 text-muted-foreground">{text}</p>}
    </div>
  );
}

export function InlineLoading() {
  return (
    <span
      className="inline-block w-4 h-4 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin"
      role="status"
      aria-label="Loading"
    />
  );
}
