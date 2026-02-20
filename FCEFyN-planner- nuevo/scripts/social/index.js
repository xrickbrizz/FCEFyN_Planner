import Messaging from "./messaging.js";
import Friends from "./friends.js";
import Professors from "./professors.js";
import Profile from "./profile.js";
import Directory from "./directory.js";

const Social = {
  async init(ctx){
    if (!ctx.socialState){
      ctx.socialState = {
        friendRequests: { incoming:[], outgoing:[] },
        friendsList: [],
        activeChatId: null,
        activeChatPartner: null,
        messagesUnsubscribe: null,
        messagesCache: {},
        statusUnsubscribe: null,
        userStatusMap: new Map(),
        showLastSeenPref: true,
        requestsLoading: true,
        friendsLoading: true,
        messengerInitialCollapsed: false,
        allUsersCache: [],
        userProfileCache: new Map(),
        usersSearchList: null,
        usersSearchInput: null,
        usersLoading: false,
        usersSearchResults: [],
        friendsFilter: "all",
        friendsSearch: ""
      };
    }

    ctx.socialModules = { Messaging, Friends, Professors, Profile, Directory };

    Profile.init(ctx);
    Directory.init(ctx);
    Friends.init(ctx);
    Messaging.init(ctx);

    await Profile.load();
    await Professors.init(ctx);

    try{
      await Friends.loadFriendRequests();
    }catch(error){
      console.error("[Mensajeria] loadFriendRequests error", error?.code, error?.message, error);
      if (ctx.isBlockedByClientError?.(error)) ctx.notifyBlockedByClient?.();
      ctx.notifyError?.("No se pudieron cargar las solicitudes de amistad.");
      ctx.socialState.friendRequests = { incoming: [], outgoing: [] };
      ctx.socialState.requestsLoading = false;
      Friends.renderFriendRequestsUI();
      Directory.renderUsersSearchList();
    }
    await Friends.loadFriendsList();
    await Messaging.loadChatsFallback({ silent:true, onlyIfEmpty:true });
    try{
      await Messaging.initPresence();
    }catch(error){
      console.error("[Mensajeria] initPresence error", error?.code, error?.message, error);
      if (ctx.isBlockedByClientError?.(error)) ctx.notifyBlockedByClient?.();
      ctx.notifyError?.("No se pudo inicializar la presencia. La mensajería sigue disponible.");
    }
    await Messaging.ensureLastSeenPref();
  },
  open(tabName){
    if (tabName === "mensajes"){
      Friends.renderFriendRequestsUI();
      Friends.renderFriendsList();
      Messaging.renderMessaging();
    }
    if (tabName === "profesores"){
      Professors.renderProfessorsSection();
    }
    if (tabName === "perfil"){
      Profile.renderProfileSection();
    }
  },
  teardown(){},
};

export default Social;
