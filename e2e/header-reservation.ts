import { expect, type Page } from '@playwright/test';

export const HEADER_AUTH_SLOT_WIDTH = 200;

type Box = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const waitForLayoutFrame = async (page: Page): Promise<void> => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
};

const expectBoxesToMatch = (actual: Box, expected: Box, message: string): void => {
  expect(Math.abs(actual.x - expected.x), `${message} x`).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y), `${message} y`).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width), `${message} width`).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - expected.height), `${message} height`).toBeLessThanOrEqual(1);
};

export const assertSignedOutAuthHydrationKeepsHeaderStable = async (page: Page): Promise<void> => {
  await page.locator('.header').waitFor();

  // The 200px reservation exists to absorb auth HYDRATION. A build with no
  // VITE_CLERK_PUBLISHABLE_KEY never hydrates: AuthHeaderWidget short-circuits
  // to an empty `.auth-header-widget-disabled` container and the slot collapses
  // on purpose, so there is no hydration swap to hold space for. Asserting the
  // reservation there would pin dead space, not stability.
  const authDisabled = await page.evaluate(() => Boolean(
    document.querySelector('#authWidgetMount .auth-header-widget-disabled'),
  ));
  if (authDisabled) {
    const collapsed = await page.evaluate(() => {
      const authMount = document.getElementById('authWidgetMount');
      if (!authMount) throw new Error('missing header auth reservation elements');
      return {
        minWidth: getComputedStyle(authMount).minWidth,
        skeletonCount: authMount.querySelectorAll('.auth-header-skeleton').length,
        signInCount: authMount.querySelectorAll('.auth-signin-btn, .auth-signup-link').length,
      };
    });
    // The regression this guards: sticky `isPending` painting its two skeleton
    // spans forever as blank boxes beside the settings cog.
    expect(collapsed.skeletonCount, 'auth-disabled build must paint no skeletons').toBe(0);
    expect(collapsed.signInCount, 'auth-disabled build must offer no dead sign-in CTAs').toBe(0);
    expect(collapsed.minWidth, 'auth-disabled build must collapse the reserved slot').toBe('0px');
    return;
  }

  const result = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.header');
    const authMount = document.getElementById('authWidgetMount');
    if (!header || !authMount) {
      throw new Error('missing header auth reservation elements');
    }

    const rectOf = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    };

    const beforeHeaderBox = rectOf(header);
    const beforeAuthMountBox = rectOf(authMount);
    const pendingSkeletonCount = authMount.querySelectorAll('.auth-header-skeleton').length;

    const widget = document.createElement('div');
    widget.className = 'auth-header-widget';

    const signInButton = document.createElement('button');
    signInButton.className = 'auth-signin-btn';
    signInButton.type = 'button';
    signInButton.textContent = 'Sign In';
    widget.appendChild(signInButton);

    const signUpButton = document.createElement('button');
    signUpButton.className = 'auth-signup-link';
    signUpButton.type = 'button';
    signUpButton.textContent = 'Create account';
    widget.appendChild(signUpButton);

    authMount.replaceChildren(widget);

    return {
      beforeAuthMountBox,
      beforeHeaderBox,
      pendingSkeletonCount,
    };
  });

  await waitForLayoutFrame(page);

  const hydrated = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.header');
    const authMount = document.getElementById('authWidgetMount');
    const widget = authMount?.querySelector<HTMLElement>('.auth-header-widget');
    if (!header || !authMount || !widget) {
      throw new Error('missing hydrated header auth elements');
    }

    const rectOf = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    };

    return {
      afterAuthMountBox: rectOf(authMount),
      afterHeaderBox: rectOf(header),
      hydratedWidgetBox: rectOf(widget),
      authMountMinWidth: getComputedStyle(authMount).minWidth,
    };
  });

  expect(hydrated.authMountMinWidth).toBe(`${HEADER_AUTH_SLOT_WIDTH}px`);
  expect(result.beforeAuthMountBox.width).toBeGreaterThanOrEqual(HEADER_AUTH_SLOT_WIDTH);
  expect(hydrated.afterAuthMountBox.width).toBeGreaterThanOrEqual(HEADER_AUTH_SLOT_WIDTH);
  expect(hydrated.hydratedWidgetBox.width).toBeGreaterThan(180);
  expect(hydrated.hydratedWidgetBox.width).toBeLessThanOrEqual(HEADER_AUTH_SLOT_WIDTH + 1);
  if (result.pendingSkeletonCount > 0) {
    expect(result.pendingSkeletonCount).toBe(2);
  }
  expectBoxesToMatch(hydrated.afterAuthMountBox, result.beforeAuthMountBox, 'auth mount');
  expectBoxesToMatch(hydrated.afterHeaderBox, result.beforeHeaderBox, 'header');
};
