interface ErrorMessageProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ title = 'Error', message, onRetry }: ErrorMessageProps) {
  return (
    <div className="p-6 border border-red-200 bg-red-50 rounded-lg dark:border-red-800/30 dark:bg-red-950/20">
      <h3 className="text-lg font-semibold text-red-800 dark:text-red-400">{title}</h3>
      <p className="text-red-600 dark:text-red-300 mt-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function ApiError({
  error,
  onRetry,
}: {
  error: { message?: string; code?: string };
  onRetry?: () => void;
}) {
  return (
    <ErrorMessage
      title="Something went wrong"
      message={error.message || 'An unexpected error occurred'}
      {...(onRetry && { onRetry })}
    />
  );
}
