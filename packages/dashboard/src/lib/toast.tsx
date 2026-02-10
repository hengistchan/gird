import { create } from 'react-dom/client';
import type { ReactNode } from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
}

let toastContainer: HTMLDivElement | null = null;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    `;
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function Toast({ message, type = 'info' }: ToastProps) {
  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  }[type];

  return (
    <div
      className={`${bgColor} text-white px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-md animate-fade-in`}
      role="alert"
    >
      {message}
    </div>
  );
}

export const toast = {
  show({ message, type = 'info', duration = 3000 }: ToastProps) {
    const container = ensureContainer();
    const toastElement = document.createElement('div');
    container.appendChild(toastElement);

    const root = create(toastElement);
    root.render(<Toast message={message} type={type} />);

    setTimeout(() => {
      toastElement.remove();
      root.unmount();
    }, duration);
  },

  success(message: string, duration?: number) {
    this.show({ message, type: 'success', duration });
  },

  error(message: string, duration?: number) {
    this.show({ message, type: 'error', duration });
  },

  info(message: string, duration?: number) {
    this.show({ message, type: 'info', duration });
  },
};

// Export notify for compatibility with existing code
export const notify = toast;
