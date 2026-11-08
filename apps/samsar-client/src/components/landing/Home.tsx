import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Routes, Route, useLocation, Navigate, useParams } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import axios from "axios";
import 'react-tooltip/dist/react-tooltip.css';


import { getAuthToken, persistAuthToken } from '../../utils/web.jsx';
import { appendRouteSearch } from '../../utils/vidgenieRouting.js';
import {
  buildLoginPathForRedirect,
  consumeResolvedAuthRedirect,
  getRedirectParam,
  getRoutePath,
  resolvePostAuthDestination,
  resolvePostSignupDestination,
} from '../../utils/authRedirect.js';
import { useUser } from "../../contexts/UserContext";
import { useColorMode } from "../../contexts/ColorMode.jsx";
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';
import VidgenieSkeletonLoader from '../oneshot_editor/VidgenieSkeletonLoader.jsx';
import StudioSkeletonLoader from '../video/util/StudioSkeletonLoader.jsx';
import PageSkeletonLoader from '../common/PageSkeletonLoader.jsx';
import RouteLoadingScreen from '../common/RouteLoadingScreen.jsx';

const EditorHome = lazy(() => import("../editor/EditorHome.tsx"));
const UserAccount = lazy(() => import("../account/UserAccount.tsx"));
const PublicationHome = lazy(() => import("../publication/PublicationHome.tsx"));
const VerificationHome = lazy(() => import("../verification/VerificationHome.tsx"));
const VideoHome = lazy(() => import("../video/VideoHome.jsx"));
const VideoEditorLandingHome = lazy(() => import("../video/VideoEditorLandingHome.jsx"));
const ListVideoSessions = lazy(() => import("../video/sessions/ListVideoSessions.jsx"));
const QuickEditorContainer = lazy(() => import("../quick_editor/QuickEditorContainer.jsx"));
const EmailVerificationHome = lazy(() => import("../verification/EmailVerificationHome.jsx"));
const loadOneshotEditorContainer = () => import('../oneshot_editor/OneshotEditorContainer.jsx');
const OneshotEditorContainer = lazy(loadOneshotEditorContainer);
const QuickEditorLandingHome = lazy(() => import("../quick_editor/QuickEditorLandingHome.jsx"));
const MobileVideoLandingHome = lazy(() => import("../mobile/MobileVideoLandingHome.jsx"));
const LoginPage = lazy(() => import("../auth/pages/LoginPage.jsx"));
const ForgotPasswordPage = lazy(() => import("../auth/pages/ForgotPasswordPage.jsx"));
const ResetPasswordPage = lazy(() => import("../auth/pages/ResetPasswordPage.jsx"));
const RegisterPage = lazy(() => import("../auth/pages/RegisterPage.jsx"));
const ExtensionAuthBridge = lazy(() => import("../auth/ExtensionAuthBridge.jsx"));
const AdVideoCreatorContainer = lazy(() => import("../advideo_creator/AdVideoCreatorContainer.jsx"));
const PaymentsSuccess = lazy(() => import("../payments/PaymentsSuccess.jsx"));
const PaymentsFailure = lazy(() => import("../payments/PaymentsFailure.jsx"));
const CreatePayment = lazy(() => import("../payments/CreatePayment.jsx"));
const MovieGeneratorContainer = lazy(() => import("../movie_gen/MovieGeneratorContainer.jsx"));
const ImageStudioHome = lazy(() => import("../image/ImageStudioHome.jsx"));
const ListImageSessions = lazy(() => import("../image/sessions/ListImageSessions.jsx"));
const ImageStudioLandingHome = lazy(() => import("../image/ImageStudioLandingHome.jsx"));
const AudioStudioHome = lazy(() => import("../audio/AudioStudioHome.jsx"));
const ExternalStudioDashboard = lazy(() => import("../external/ExternalStudioDashboard.jsx"));
const GenerationsHome = lazy(() => import("../generations/GenerationsHome.jsx"));

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const STANDALONE_PUBLIC_AUTH_PATHS = new Set([
  '/login',
  '/forgot_password',
  '/reset_password',
  '/verify',
  '/verify_email',
]);

function preloadVidgenieEditor() {
  return loadOneshotEditorContainer().then(({ preloadOneshotEditor }) => preloadOneshotEditor());
}

function getSanitizedRouteSearch(search) {
  const params = new URLSearchParams(search);
  params.delete('loginToken');
  params.delete('authToken');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function getRouteLoadingFallback(pathname, isMobile) {
  const route = pathname.split('/')[1];
  if (isMobile && /^\/video\/(share|collab)\//.test(pathname)) return <RouteLoadingScreen />;
  if (['vidgenie', 'vidgpt', 'videogpt', 'vidgemie'].includes(route)
      || (isMobile && ['', 'video', 'quick_video'].includes(route))) {
    return <VidgenieSkeletonLoader />;
  }
  if (route === 'quick_video') return <PageSkeletonLoader page="quick" />;
  if (route === 'video' || route === '') return <StudioSkeletonLoader />;
  if (['image', 'iamge'].includes(route)) return <PageSkeletonLoader page="image" />;
  if (route === 'audio') return <PageSkeletonLoader page="audio" />;
  if (route === 'account') return <PageSkeletonLoader page="account" />;
  if (route === 'generations') return <PageSkeletonLoader page="gallery" />;
  if (['my_sessions', 'image_sessions'].includes(route)) return <PageSkeletonLoader page="projects" />;
  if (['login', 'register', 'forgot_password', 'reset_password'].includes(route)) return <PageSkeletonLoader page="auth" />;
  return <RouteLoadingScreen />;
}

function DefaultEntrySkeleton({ isMobile }) {
  return IS_STANDALONE_DEPLOYMENT && !isMobile
    ? <StudioSkeletonLoader /> : <VidgenieSkeletonLoader />;
}

function SharedVideoDesktopOnlyMessage() {
  useUiLanguage();
  const { colorMode } = useColorMode();
  const isDark = colorMode === 'dark';

  return (
    <div
      className={`flex min-h-screen items-center justify-center px-6 ${
        isDark
          ? 'bg-[#0c0d12] text-slate-100'
          : 'bg-[#f7f9fc] text-slate-800'
      }`}
    >
      <p className="text-center text-sm font-medium">{uiText("Open link on desktop to edit.")}</p>
    </div>
  );
}

function VidgenieRouteRedirect() {
  useUiLanguage();
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={appendRouteSearch(id ? `/vidgenie/${id}` : '/vidgenie', getSanitizedRouteSearch(search))} replace />;
}

function MobileStudioSessionRedirect() {
  useUiLanguage();
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={appendRouteSearch(id ? `/vidgenie/${id}` : '/vidgenie', getSanitizedRouteSearch(search))} replace />;
}

function DefaultAuthenticatedRoute({ user, isMobile, search }) {
  useUiLanguage();
  const [destination, setDestination] = useState(null);
  const resolutionRef = useRef(null);
  const resolutionKey = JSON.stringify([user?._id, Boolean(user?.isExternalUser), isMobile, search]);

  useEffect(() => {
    if (!user?._id) return undefined;

    if (resolutionRef.current?.key !== resolutionKey) {
      const fallbackPath = IS_STANDALONE_DEPLOYMENT && !isMobile ? '/video' : '/vidgenie';
      resolutionRef.current = {
        key: resolutionKey,
        promise: Promise.resolve().then(() => resolvePostAuthDestination({
          user,
          isMobile,
          apiServer: PROCESSOR_SERVER,
          search,
          createIfMissing: true,
        })).then((path) => path || appendRouteSearch(fallbackPath, search))
          .catch(() => appendRouteSearch(fallbackPath, search)),
      };
    }

    let cancelled = false;
    void resolutionRef.current.promise.then((path) => {
      if (cancelled) return;
      if (path.startsWith('/vidgenie')) {
        void preloadVidgenieEditor().catch(() => undefined);
      }
      setDestination({ key: resolutionKey, path });
    });
    return () => { cancelled = true; };
  }, [isMobile, resolutionKey, search, user]);

  if (destination?.key === resolutionKey) {
    return <Navigate to={destination.path} replace />;
  }

  return <DefaultEntrySkeleton isMobile={isMobile} />;
}

export default function Home() {
  useUiLanguage();
  const { user, getUserAPI, resetUser, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const location = useLocation(); 
  const isMobile = useMediaQuery({ query: '(max-width: 767px)' });

  const { colorMode } = useColorMode();
  // Resolve route options on the first render, before root bootstrap effects
  // run. Updating them in an effect loses options on fast authentication.
  const sanitizedRouteSearch = useMemo(() => getSanitizedRouteSearch(location.search), [location.search]);
  const hasPendingLoginToken = location.pathname !== '/verify' && Boolean(new URLSearchParams(location.search).get('loginToken'));
  const initialUserFetchStartedRef = useRef(false);
  const initialRootHydrationRef = useRef(null);
  const initialRootResolutionRef = useRef(null);
  const loginTokenExchangeRef = useRef(null);
  const initialEntryRef = useRef(null);
  if (initialEntryRef.current === null && typeof window !== 'undefined') {
    const initialSearchParams = new URLSearchParams(window.location.search);
    initialEntryRef.current = {
      pathname: window.location.pathname,
      search: window.location.search,
      hasAuthToken: Boolean(getAuthToken()),
      hasLoginToken: Boolean(initialSearchParams.get('loginToken')),
    };
  }
  const shouldResolveInitialAuthenticatedRoot =
    Boolean(initialEntryRef.current?.hasAuthToken) &&
    !initialEntryRef.current?.hasLoginToken &&
    initialEntryRef.current?.pathname === '/';
  const [initialAuthenticatedRootStatus, setInitialAuthenticatedRootStatus] = useState(
    shouldResolveInitialAuthenticatedRoot ? 'pending' : 'done'
  );

  useEffect(() => {
    if (shouldResolveInitialAuthenticatedRoot && initialAuthenticatedRootStatus === 'pending') {
      return;
    }

    if (initialUserFetchStartedRef.current) {
      return;
    }

    const queryParams = new URLSearchParams(location.search);
    const loginToken = queryParams.get('loginToken');
    if (loginToken && location.pathname !== '/verify') {
      return;
    }
    initialUserFetchStartedRef.current = true;
    getUserAPI();
  }, [
    getUserAPI,
    initialAuthenticatedRootStatus,
    location.pathname,
    location.search,
    shouldResolveInitialAuthenticatedRoot,
  ]);

  const isExternalUser = Boolean(user?.isExternalUser);
  const isVidgeniePath = location.pathname.startsWith('/vidgenie') || location.pathname.startsWith('/vidgemie');
  const isAccessAllowedPath = (() => {
    if (location.pathname.startsWith('/video/share/')) return true;
    if (location.pathname.startsWith('/video/collab/')) return true;
    if (location.pathname === '/video' || location.pathname.startsWith('/video/')) return true;
    if (location.pathname.startsWith('/external/studio') && isExternalUser) return true;
    if (isVidgeniePath) return true;
    if (location.pathname.startsWith('/account') || location.pathname.startsWith('/accounts')) return true;
    if (location.pathname === '/image_sessions' && user) return true;
    if (location.pathname === '/audio/studio' && user) return true;
    const allowed = new Set([
      '/login',
      '/register',
      '/forgot_password',
      '/reset_password',
      '/verify',
      '/verify_email',
      '/extension-auth',
      '/payment_success',
      '/payment_cancel',
      '/create_payment',
      '/generations',
      '/image/studio',
      '/iamge/studio',
    ]);
    return allowed.has(location.pathname);
  })();

  useEffect(() => {
    if (hasPendingLoginToken) return;
    if (initialAuthenticatedRootStatus === 'pending') return;
    if (!userInitiated || userFetching) return;
    if (location.pathname === '/') return;
    if (isExternalUser) {
      if (location.pathname !== '/external/studio' && location.pathname !== '/verify') {
        navigate('/external/studio', { replace: true });
      }
      return;
    }
    if (user?._id) return;
    if (IS_STANDALONE_DEPLOYMENT) {
      if (!STANDALONE_PUBLIC_AUTH_PATHS.has(location.pathname)) {
        navigate('/login', { replace: true });
      }
      return;
    }
    if (isAccessAllowedPath) return;

    if (location.pathname !== '/login') {
      navigate(buildLoginPathForRedirect(getRoutePath(location)), { replace: true });
    }
  }, [
    hasPendingLoginToken,
    initialAuthenticatedRootStatus,
    userInitiated,
    userFetching,
    isAccessAllowedPath,
    user,
    location.pathname,
    location.search,
    navigate,
    isExternalUser,
  ]);

  const navigateToDefaultAuthenticatedView = useCallback(async (resolvedUser = user) => {
    const targetPath = await resolvePostAuthDestination({
      user: resolvedUser,
      isMobile,
      apiServer: PROCESSOR_SERVER,
      search: sanitizedRouteSearch,
      createIfMissing: true,
    });
    if (targetPath?.startsWith('/vidgenie')) {
      void preloadVidgenieEditor().catch(() => undefined);
    }
    const fallbackPath = IS_STANDALONE_DEPLOYMENT && !isMobile ? '/video' : '/vidgenie';
    navigate(targetPath || appendRouteSearch(fallbackPath, sanitizedRouteSearch), { replace: true });
  }, [isMobile, navigate, sanitizedRouteSearch, user]);

  useEffect(() => {
    if (!shouldResolveInitialAuthenticatedRoot || initialAuthenticatedRootStatus !== 'pending') {
      return undefined;
    }

    if (location.pathname !== '/') {
      setInitialAuthenticatedRootStatus('done');
      return undefined;
    }

    const authToken = getAuthToken();
    const routeKey = JSON.stringify([sanitizedRouteSearch, isMobile, IS_STANDALONE_DEPLOYMENT, authToken]);
    const accountId = user?._id?.toString?.() || null;
    let operation = initialRootResolutionRef.current;
    if (operation?.routeKey !== routeKey || operation?.accountId !== accountId) {
      operation = { active: false, promise: null, routeKey, accountId };
    }
    initialRootResolutionRef.current = operation;
    operation.active = true;
    initialUserFetchStartedRef.current = true;
    if (!operation.promise) {
      operation.promise = (async () => {
        let resolvedUser = user;
        if (!userInitiated || userFetching) {
          if (initialRootHydrationRef.current?.authToken !== authToken) {
            initialRootHydrationRef.current = {
              authToken,
              promise: Promise.resolve().then(() => getUserAPI()),
            };
          }
          resolvedUser = await initialRootHydrationRef.current.promise;
        }
        // Hydrating the same account can rerender Home before its destination
        // resolves. Adopt that identity before creating a project so this
        // profile update reuses the lookup; account switches invalidate it.
        operation.accountId = resolvedUser?._id?.toString?.() || null;
        if (!operation.active) return null;

        if (!resolvedUser?._id) {
          return '/login';
        }

        if (resolvedUser.isExternalUser) {
          return '/external/studio';
        }

        const fallbackPath = IS_STANDALONE_DEPLOYMENT && !isMobile ? '/video' : '/vidgenie';
        try {
          const targetPath = await resolvePostAuthDestination({
            user: resolvedUser,
            isMobile,
            apiServer: PROCESSOR_SERVER,
            search: sanitizedRouteSearch,
            createIfMissing: true,
          });
          return targetPath || appendRouteSearch(fallbackPath, sanitizedRouteSearch);
        } catch {
          return appendRouteSearch(fallbackPath, sanitizedRouteSearch);
        }
      })().catch(() => '/login');
    }

    let isCancelled = false;
    void operation.promise.then((targetPath) => {
      if (isCancelled || !targetPath) return;
      if (targetPath.startsWith('/vidgenie')) {
        void preloadVidgenieEditor().catch(() => undefined);
      }
      navigate(targetPath, { replace: true });
      setInitialAuthenticatedRootStatus('done');
    });

    return () => {
      isCancelled = true;
      operation.active = false;
    };
  }, [
    getUserAPI,
    initialAuthenticatedRootStatus,
    isMobile,
    location.pathname,
    navigate,
    sanitizedRouteSearch,
    shouldResolveInitialAuthenticatedRoot,
    user,
    userFetching,
    userInitiated,
  ]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return undefined;
    }

    const channel = new BroadcastChannel('oauth_channel');
    channel.onmessage = async (event) => {
      const isOAuthComplete =
        event.data === 'oauth_complete' ||
        event.data?.type === 'oauth_complete';
      if (isOAuthComplete) {
        const resolvedUser = await getUserAPI();
        if (event.data?.isNewUser === true) {
          const destination = await resolvePostSignupDestination({
            isMobile,
            apiServer: PROCESSOR_SERVER,
          });
          navigate(destination, { replace: true });
          return;
        }
        const redirectTarget = consumeResolvedAuthRedirect();
        if (redirectTarget && !IS_STANDALONE_DEPLOYMENT) {
          navigate(redirectTarget, { replace: true });
          return;
        }
        void navigateToDefaultAuthenticatedView(resolvedUser);
      }
    };

    return () => {
      channel.close();
    };
  }, [getUserAPI, isMobile, navigate, navigateToDefaultAuthenticatedView]);

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const loginToken = queryParams.get('loginToken');

    if (!loginToken || location.pathname === '/verify') {
      return;
    }

    // Effect replay and user hydration can rerender Home before the token is
    // removed from the URL. Share each phase rather than consuming it again.
    let operation = loginTokenExchangeRef.current;
    if (operation?.token !== loginToken) {
      operation = {
        token: loginToken,
        verification: Promise.resolve().then(() => axios.get(`${PROCESSOR_SERVER}/users/verify_token`, {
          params: { loginToken, _: Date.now() },
        })),
        authentication: null,
        destination: null,
        finished: false,
        path: null,
      };
      loginTokenExchangeRef.current = operation;
    }
    if (operation.finished) {
      navigate(operation.path, { replace: true });
      return undefined;
    }
    let isCancelled = false;

    const exchangeLoginToken = async () => {
      const returnToLogin = () => {
        if (isCancelled || operation.finished) return;
        operation.finished = true;
        operation.path = buildLoginPathForRedirect(getRedirectParam(location));
        resetUser();
        navigate(operation.path, { replace: true });
      };

      try {
        const response = await operation.verification;
        if (isCancelled || operation.finished) return;
        const resolvedAuthToken = response?.data?.authToken;
        if (resolvedAuthToken) {
          if (!operation.authentication) {
            persistAuthToken(resolvedAuthToken);
            initialUserFetchStartedRef.current = true;
            operation.authentication = Promise.resolve().then(() => getUserAPI());
          }
          const resolvedUser = await operation.authentication;
          if (isCancelled || operation.finished) return;
          if (!resolvedUser?._id) {
            returnToLogin();
            return;
          }

          if (!operation.destination) {
            operation.destination = (async () => {
              const redirectTarget = consumeResolvedAuthRedirect(getRedirectParam(location));
              if (redirectTarget && !IS_STANDALONE_DEPLOYMENT) return redirectTarget;
              const fallbackPath = IS_STANDALONE_DEPLOYMENT && !isMobile ? '/video' : '/vidgenie';
              try {
                const targetPath = await resolvePostAuthDestination({
                  user: resolvedUser,
                  isMobile,
                  apiServer: PROCESSOR_SERVER,
                  search: sanitizedRouteSearch,
                  createIfMissing: true,
                });
                return targetPath || appendRouteSearch(fallbackPath, sanitizedRouteSearch);
              } catch {
                return appendRouteSearch(fallbackPath, sanitizedRouteSearch);
              }
            })();
          }
          const destination = await operation.destination;
          if (isCancelled || operation.finished) return;
          operation.finished = true;
          operation.path = destination;
          if (destination.startsWith('/vidgenie')) {
            void preloadVidgenieEditor().catch(() => undefined);
          }
          navigate(destination, { replace: true });
          return;
        }
      } catch  {
        returnToLogin();
        return;
      }

      returnToLogin();
    };

    void exchangeLoginToken();
    return () => { isCancelled = true; };
  }, [
    location.pathname,
    location.search,
    getUserAPI,
    navigate,
    isMobile,
    sanitizedRouteSearch,
    resetUser,
  ]);

  let bodyBGColor = "bg-stone-100";
  
  if (colorMode === 'dark') {
    bodyBGColor = "bg-[#0c0d12] text-slate-100";
  } else {
    bodyBGColor = "bg-[#f7f9fc] text-slate-900";
  }
  const rootAuthenticatedSearch = sanitizedRouteSearch;
  const routeLoadingFallback = getRouteLoadingFallback(location.pathname, isMobile);
  const shouldRequireStandaloneLogin =
    IS_STANDALONE_DEPLOYMENT &&
    userInitiated &&
    !userFetching &&
    !user?._id &&
    !STANDALONE_PUBLIC_AUTH_PATHS.has(location.pathname);

  if (initialAuthenticatedRootStatus === 'pending') {
    return (
      <div className={bodyBGColor}>
        <DefaultEntrySkeleton isMobile={isMobile} />
      </div>
    );
  }

  if (hasPendingLoginToken) {
    return <div className={bodyBGColor}>{location.pathname === "/" ? <DefaultEntrySkeleton isMobile={isMobile} /> : routeLoadingFallback}</div>;
  }

  if (shouldRequireStandaloneLogin) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className={bodyBGColor}>
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route
            path="/"
            element={
              !userInitiated || userFetching
                ? (getAuthToken() ? <DefaultEntrySkeleton isMobile={isMobile} /> : routeLoadingFallback)
                : user && user._id
                  ? <DefaultAuthenticatedRoute user={user} isMobile={isMobile} search={rootAuthenticatedSearch} />
                  : isMobile
                    ? <MobileVideoLandingHome />
                    : <VideoEditorLandingHome />
            }
          />
          <Route path="/generations" element={<GenerationsHome />} />
          <Route path="/session/:id" element={<EditorHome />} />
          <Route path="/video" element={isMobile ? <MobileVideoLandingHome /> : <VideoEditorLandingHome />} />
          <Route path="/video/share/:shareToken" element={isMobile ? <SharedVideoDesktopOnlyMessage /> : <VideoHome />} />
          <Route path="/video/collab/:editableShareToken" element={isMobile ? <SharedVideoDesktopOnlyMessage /> : <VideoHome />} />
          <Route path="/video/:id" element={isMobile ? <MobileStudioSessionRedirect /> : <VideoHome />} />
          <Route path="/image/studio" element={<ImageStudioLandingHome />} />
          <Route path="/image/studio/:id" element={<ImageStudioHome />} />
          <Route path="/audio/studio" element={<AudioStudioHome />} />
          <Route path="/iamge/studio" element={<ImageStudioLandingHome />} />
          <Route path="/iamge/studio/:id" element={<ImageStudioHome />} />
          <Route path="/external/studio" element={<ExternalStudioDashboard />} />
          <Route path="/quick_video/:id" element={isMobile ? <OneshotEditorContainer /> : <QuickEditorContainer />} />
          <Route path="/quick_video" element={isMobile ? <OneshotEditorContainer /> : <QuickEditorLandingHome />} />
          <Route path="/vidgpt" element={<OneshotEditorContainer />} />
          <Route path="/vidgpt/:id" element={<OneshotEditorContainer />} />
          <Route path="/vidgemie" element={<VidgenieRouteRedirect />} />
          <Route path="/vidgemie/:id" element={<VidgenieRouteRedirect />} />
          <Route path="/vidgenie" element={<OneshotEditorContainer />} />
          <Route path="/vidgenie/:id" element={<OneshotEditorContainer />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot_password" element={<ForgotPasswordPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/extension-auth" element={<ExtensionAuthBridge />} />
          <Route path="/adcreator" element={<AdVideoCreatorContainer />} />
          <Route path="/adcreator/:id" element={<AdVideoCreatorContainer />} />
          <Route path="/reset_password" element={<ResetPasswordPage />} />
          <Route path="/videogpt" element={<OneshotEditorContainer />} />
          <Route path="/videogpt/:id" element={<OneshotEditorContainer />} />
          <Route path="/movie_maker" element={<MovieGeneratorContainer />} />
          <Route path="/movie_maker/:id" element={<MovieGeneratorContainer />} />
          <Route path="/my_sessions" element={<ListVideoSessions />} />
          <Route path="/image_sessions" element={<ListImageSessions />} />
          <Route path="/create_payment" element={<CreatePayment />} />
          <Route path="/account/*" element={<UserAccount />} />
          <Route path="/publication/:id" element={<PublicationHome />} />
          <Route path="/verify" element={<VerificationHome />} />
          <Route path="/verify_email" element={<EmailVerificationHome />} />
          <Route path="/payment_success" element={<PaymentsSuccess />} />
          <Route path="/payment_cancel" element={<PaymentsFailure />} />
        </Routes>
      </Suspense>
    </div>
  );
}
