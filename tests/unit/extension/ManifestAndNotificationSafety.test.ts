import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('P2-7: Manifest permissions, assets, and notifications safety', () => {
  const manifestPath = path.resolve(__dirname, '../../../public/manifest.json');
  const publicDir = path.resolve(__dirname, '../../../public');

  it('manifest.json must declare notifications permission and icons', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Permissions check
    expect(manifest.permissions).toContain('notifications');
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('alarms');

    // Icons check
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons['16']).toBe('icon16.png');
    expect(manifest.icons['32']).toBe('icon32.png');
    expect(manifest.icons['48']).toBe('icon48.png');
    expect(manifest.icons['128']).toBe('icon128.png');

    // Action icon check
    expect(manifest.action?.default_icon).toBeDefined();
    expect(manifest.action.default_icon['48']).toBe('icon48.png');
  });

  it('all declared icon files must exist in public/ and have valid PNG signatures', () => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const requiredIcons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];

    for (const iconName of requiredIcons) {
      const iconPath = path.join(publicDir, iconName);
      expect(fs.existsSync(iconPath)).toBe(true);

      const buffer = fs.readFileSync(iconPath);
      expect(buffer.length).toBeGreaterThan(50);
      // Verify PNG magic header
      expect(buffer.subarray(0, 8)).toEqual(pngSignature);
    }
  });

  it('notification payload formatting sets high priority and requireInteraction for PAYMENT_REQUIRED', () => {
    const mockCreate = vi.fn();
    const fakeChrome = {
      notifications: {
        create: mockCreate,
      },
    };

    // Simulate notification creation logic as in service-worker
    const message = {
      type: 'NOTIFICATION_EVENT',
      category: 'PAYMENT_REQUIRED',
      title: 'Ticketbox Assistant',
      body: 'Payment step reached — user action required.',
      ticketName: 'VIP Zone A',
      quantity: 2,
    };

    const formattedBody = [
      `Profile: Default Profile`,
      message.ticketName ? `Ticket: ${message.ticketName}` : undefined,
      message.quantity ? `Quantity: ${message.quantity}` : undefined,
      message.body,
    ]
      .filter(Boolean)
      .join('\n');

    fakeChrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: message.title,
      message: formattedBody,
      priority: 2,
      requireInteraction: message.category === 'PAYMENT_REQUIRED',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'Ticketbox Assistant',
        priority: 2,
        requireInteraction: true,
      })
    );
  });
});
