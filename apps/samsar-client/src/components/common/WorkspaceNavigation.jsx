import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import TopNav from './TopNav.tsx';
import MobileTopNav from './MobileTopNav.tsx';
import { AlertDialog } from './AlertDialog.tsx';

const NavigationContext = createContext(null);
const EMPTY_PROPS = {};

function NavigationView({ responsive = true, loading = false, navProps = EMPTY_PROPS }) {
  const isMobile = useMediaQuery({ maxWidth: 767 });
  return responsive && isMobile
    ? <MobileTopNav {...navProps} isWorkspaceLoading={loading} />
    : <TopNav {...navProps} isWorkspaceLoading={loading} />;
}

// Outside route Suspense: the brand, navigation, account and dialog surface
// remain mounted while pages load. Only ready pages supply session actions.
export function WorkspaceNavigationProvider({ children }) {
  const { pathname } = useLocation();
  const [registration, setRegistration] = useState(null);
  const current = registration?.pathname === pathname ? registration : null;
  return <NavigationContext.Provider value={setRegistration}>
    <NavigationView responsive={current?.responsive ?? true} loading={current?.loading ?? true} navProps={current?.navProps} />
    <AlertDialog />
    {children}
  </NavigationContext.Provider>;
}

export default function WorkspaceNavigation({ responsive = false, loading = false, ...navProps }) {
  const register = useContext(NavigationContext);
  const { pathname } = useLocation();
  const owner = useRef(Symbol('navigation owner'));
  useLayoutEffect(() => {
    if (!register) return;
    register(current => {
      const unchanged = current?.owner === owner.current && current.pathname === pathname
        && current.responsive === responsive && current.loading === loading
        && Object.keys(current.navProps).length === Object.keys(navProps).length
        && Object.keys(navProps).every(key => current.navProps[key] === navProps[key]);
      return unchanged ? current : { owner: owner.current, pathname, responsive, loading, navProps };
    });
  }, [register, pathname, responsive, loading, navProps]);
  useLayoutEffect(() => {
    if (!register) return undefined;
    const token = owner.current;
    return () => register(current => current?.owner === token ? null : current);
  }, [register]);
  // Keep independently rendered pages and dialogs working outside the app host.
  return register ? null : <>
    <NavigationView responsive={responsive} loading={loading} navProps={navProps} />
    <AlertDialog />
  </>;
}

export function LoadingNavigation() {
  const inRouter = useInRouterContext();
  return inRouter ? <WorkspaceNavigation responsive loading /> : null;
}
