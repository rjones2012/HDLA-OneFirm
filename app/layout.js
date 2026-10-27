import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: { default: 'OneFirm', template: 'OneFirm · %s' },
  description: 'HDLA OneFirm — the firm\'s operating platform',
  icons: { icon: '/logo_hdla.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
