# Getting Started: A Peer-to-Peer Hosted Multiplayer Game with a CharacterController

A step-by-step guide to building, by hand, the foundation of a small P2P multiplayer game in Unity 6 with **Netcode for
GameObjects** (NGO):
- a menu where one player hosts and others join;
- first-person players on a `CharacterController`;
- pushes and knockbacks;
- objects you can pick up and throw;
- a HUD.

## How this guide works

- **The scene and prefabs are premade.** The code is yours to write.
- **Each script is built a little at a time.** Every step adds a few lines, explains what each one does, and ends with
  something you can try.
- **Big ideas come first.** When a step needs a new way of thinking (what a "session" is, what an event is, who owns a
  player), a short "The idea" section explains it before any code.
- **Each script ends with a complete listing**, "The whole script so far", so you can check yours against it.

Type the code rather than pasting it. Most of the learning happens in typing it and then breaking it.

The project already has these packages installed:

| Package | What it's for |
| --- | --- |
| Netcode for GameObjects 2.13.3 | the networking: NetworkObjects, RPCs, NetworkVariables, NetworkTransform |
| Unity Transport (comes with NGO) | actually sends the bytes; works on one PC and on a LAN |
| Multiplayer Play Mode 1.3.3 | runs extra players from one editor (Window > Multiplayer > Multiplayer Play Mode) |
| Multiplayer Tools 2.2.12 | the **Network Simulator** (fake lag) and the network profiler |
| Input System 1.11.2 | keyboard and mouse |
| TextMeshPro (built into uGUI) | the UI text |

---

## 1. The big picture

### Roblox to Unity

| Roblox | Netcode for GameObjects |
| --- | --- |
| Server Script vs LocalScript | **One script runs on every machine.** `IsServer`, `IsOwner` and `IsClient` decide which part runs where |
| `RemoteEvent:FireServer` | `[Rpc(SendTo.Server)]`, a **request** the server checks |
| `RemoteEvent:FireClient` / `FireAllClients` | `[Rpc(SendTo.Owner)]` / `[Rpc(SendTo.Everyone)]` |
| Replicated attributes and values | `NetworkVariable<T>`, synced to everyone, late joiners included |
| `SetNetworkOwner` | `NetworkObject.ChangeOwnership(clientId)` |
| Everything in Workspace replicates | only objects with a `NetworkObject` exist on the network, and only the state you declare syncs |
| You press Play and you're on a server | **you** start the session: someone hosts, the others join an address |

### Peer to peer, client hosted

One player presses **Host**: their game becomes the server **and** a player at the same time. Everyone else **joins**
that player. There's no separate server machine. Two things follow:
- the host has no lag, and everyone else has their ping to the host;
- anything only the host knows is gone if the host quits.

### Four rules this whole guide follows

1. **The server decides, the client asks.** A client never says "I picked it up". It asks "may I pick it up?", and the
   server checks.
2. **Each player moves itself.** Your machine moves your player, so it feels instant. Everyone else watches it. The
   host therefore can't push your player; it asks your machine to.
3. **Physics follows ownership.** Each physics object is simulated by exactly one machine, its owner. Everyone else just
   shows where it is.
4. **State is a NetworkVariable; RPCs are moments.** "Who holds this box" is state that a late joiner must know. "A
   puff of flour" is a one-off moment.

Don't worry if these feel abstract. Each one comes back as a concrete step.

---

## 2. What's already in the scene

`Assets/Scenes/SampleScene` is built for you:

| Object | What it is |
| --- | --- |
| `Level` | the floor, four steps (0.3, 0.6, 1.0 and 1.4 m), a 20° ramp you can walk up, a 55° ramp you slide off, a low ceiling and a throw wall |
| `Boxes` | six Box prefab instances, which spawn on the network when the host starts |
| `NetworkManager` | Unity Transport on 127.0.0.1:7777, Tick Rate 60, the Player prefab, the prefab list, and the Network Simulator (no lag for now) |
| `UI` and `EventSystem` | the premade menu and HUD |
| `Main Camera` | an overview shot until your own player's camera turns on |
| `Assets/Prefabs/Player`, `Box` | the prefabs, with every component set up but no scripts |
| `Assets/DefaultNetworkPrefabs.asset` | the Network Prefabs List, holding both prefabs |

---

## 3. Starting a session: the menu

### The idea: what a "session" is

Before anyone can play, one machine has to **host** and the others have to **join** it. Four pieces make that happen:

1. **The NetworkManager** runs the session. There's exactly one, on the `NetworkManager` object, and any script can
   reach it through `NetworkManager.Singleton` ("the single one"). It starts and stops the session, spawns each
   player's prefab, and announces when people join or leave.
2. **The transport** is the part of the NetworkManager that actually carries bytes between computers. If the
   NetworkManager is the post office, the transport is the delivery van. We use **Unity Transport**.
3. **An address and a port** say where to find the host. The **address** names a computer: `127.0.0.1` always means
   "this same computer", which is why two windows on your PC can find each other; `192.168.x.x` is a computer on your
   home network. The **port** is a numbered door on that computer (we use 7777), so several programs can share one
   address.
4. **Client ids:** every machine in a session gets a number. The host is always **0** (`NetworkManager.ServerClientId`),
   and each machine that joins gets the next one. Your own number is `NetworkManager.Singleton.LocalClientId`.

The menu's job is to set the address and start the session in the right role.

### The idea: how a button click reaches your code

Unity's UI is made of ordinary GameObjects. Each part maps onto something you know from Roblox:

| Roblox | Unity UI |
| --- | --- |
| ScreenGui | a **Canvas** (here in Screen Space Overlay mode: drawn flat on top of the screen, not in the 3D world) |
| Frame | a GameObject with a **RectTransform**, often plus an **Image** |
| UDim2 | RectTransform **anchors** (where on the parent it hangs) plus its offset and size |
| TextLabel / TextBox | **TextMeshPro Text** (`TMP_Text`) / **TMP_InputField** |
| TextButton and `MouseButton1Click` | a **Button** and its `onClick` |
| a LocalScript in PlayerGui | a MonoBehaviour on the UI. **UI is always local**: never networked, and each player has their own |

What happens when you click, every frame, in order:

1. **The Input System** reads the mouse.
2. **The EventSystem** (exactly one per scene) passes it to its input module.
3. **A raycast** asks each Canvas's Graphic Raycaster what's under the pointer. Only graphics with **Raycast Target**
   ticked count, and the topmost wins. (The HUD's texts and crosshair have it off, so they never block clicks.)
4. **Pointer events** go to the winner: Enter (hover), Down (press), Up (release), then **Click**, but only if you
   released over the same object you pressed. Then Exit.
5. **The Button changes its look** by itself: Normal, Highlighted, Pressed, Selected, Disabled.
6. **On Click, the Button invokes `onClick`**, a list of methods to call. First come any wired in the Inspector, then
   any added in code with `AddListener`.
7. **Your method runs** right then, on your machine only.

Two things fall out of this:
- an **Interactable** box that's unticked means no click, which is useful while connecting;
- a **locked cursor sends no clicks at all**, so menus must unlock it.

### Step 3.1: a Host button

Create `Assets/Scripts/MenuUI.cs` (make the `Scripts` folder):

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.UI;

public class MenuUI : MonoBehaviour
{
    [SerializeField] private GameObject mainMenu;
    [SerializeField] private GameObject hud;
    [SerializeField] private Button hostButton;

    private void OnEnable()
    {
        hostButton.onClick.AddListener(OnHostClicked);
    }

    private void OnDisable()
    {
        hostButton.onClick.RemoveListener(OnHostClicked);
    }

    private void OnHostClicked()
    {
        if (NetworkManager.Singleton.StartHost())
        {
            mainMenu.SetActive(false);
            hud.SetActive(true);
        }
    }
}
```

What each piece does:
- **`[SerializeField] private`** makes a field show up in the Inspector so you can drag objects into it, while keeping
  it private to the script. It's how scripts get references to scene objects without searching for them.
- **`OnEnable` and `OnDisable`** run when this object turns on and off. Adding the listener in one and removing it in
  the other means a menu that's switched off and on never ends up with two copies of the listener. Two copies would
  host twice on one click.
- **`hostButton.onClick.AddListener(OnHostClicked)`** is the code version of wiring "On Click ()" in the Inspector:
  "when this button is clicked, call `OnHostClicked`". You pass the method's name without `()`, because you're handing
  over the method, not calling it.
- **`NetworkManager.Singleton.StartHost()`** starts the session as host: server and player in one. It returns `true` if
  it started. On `false` (say, another window already hosting on port 7777), we leave the menu up.
- **`SetActive(false)`** hides a GameObject and everything under it. `SetActive(true)` shows it.

**Hook it up:**
1. Select **`UI`** in the Hierarchy and choose **Add Component > MenuUI**.
2. Drag `UI/MainMenu` into **Main Menu**, `UI/HUD` into **Hud** (inactive objects can still be dragged), and
   `UI/MainMenu/HostButton` into **Host Button**.

Put MenuUI on `UI`, not on `MainMenu`. MenuUI hides MainMenu, and a script on a hidden object stops running, so it
could never bring the menu back.

**Try it:** press Play and click **Host**. The menu vanishes. Nothing else happens yet, because your player has no
script; that's correct.

### Step 3.2: a Join button and an address

Joining needs the host's address. Add two fields under `hostButton`:

```csharp
    [SerializeField] private Button joinButton;
    [SerializeField] private TMP_InputField addressField;
    [SerializeField] private ushort port = 7777;
```

and add `using TMPro;` and `using Unity.Netcode.Transports.UTP;` at the top.

Wire the Join button the same way as Host, in both `OnEnable` and `OnDisable`:

```csharp
        joinButton.onClick.AddListener(OnJoinClicked);      // in OnEnable
        joinButton.onClick.RemoveListener(OnJoinClicked);   // in OnDisable
```

A shortcut to the transport, then the join itself:

```csharp
    private UnityTransport Transport => (UnityTransport)NetworkManager.Singleton.NetworkConfig.NetworkTransport;

    private void OnJoinClicked()
    {
        string address = string.IsNullOrWhiteSpace(addressField.text) ? "127.0.0.1" : addressField.text.Trim();
        Transport.SetConnectionData(address, port);
        NetworkManager.Singleton.StartClient();
    }
```

What each piece does:
- **`Transport =>`** is a property with a shortcut body: every time you write `Transport`, it fetches the NetworkManager's
  transport and casts it to `UnityTransport`, so you can use Unity Transport's own methods.
- **`SetConnectionData(address, port)`** fills in the transport's address book: "when I start as a client, knock on
  this port at this address".
- **`StartClient()`** starts trying to connect. It does **not** mean you're connected yet. Step 3.4 deals with that.
- The `?:` line uses the typed address, or falls back to `127.0.0.1` if the box is empty.

Update `OnHostClicked` so the host listens properly:

```csharp
    private void OnHostClicked()
    {
        // Listen on every network card ("0.0.0.0"), so players on your LAN can reach you, not just this PC.
        Transport.SetConnectionData("127.0.0.1", port, "0.0.0.0");
        if (NetworkManager.Singleton.StartHost())
        {
            mainMenu.SetActive(false);
            hud.SetActive(true);
        }
    }
```

The third value is the **listen address**, which network cards the host accepts connections on. `0.0.0.0` means all of
them, so a friend on your Wi-Fi can join by typing your PC's `192.168.x.x` address.

**Hook it up:** drag `JoinButton` and `AddressField` into their new slots on MenuUI.

**Try it:**
1. Tick **Player 2** in Multiplayer Play Mode, and press Play.
2. Click **Host** in the main window, then **Join** in Player 2's.
3. The host's menu vanishes. Player 2's menu stays up even though it connected. That's the next problem.

### The idea: events and callbacks

`StartClient` only *starts* connecting. The answer comes later, maybe a fraction of a second, maybe a timeout seconds
later, because messages have to travel to the host and back. So you can't write "join, then hide the menu" on the next
line. Instead you **subscribe to an event**: "call my method when you find out".

The NetworkManager offers two events for this:
- **`OnClientConnectedCallback`** fires when a client has connected. It gives you that client's id.
- **`OnClientDisconnectCallback`** fires when a client has disconnected (or failed to connect). It also gives you an id.

In C#:
- `+=` **subscribes** a method: `manager.OnClientConnectedCallback += OnClientConnected;`
- `-=` **unsubscribes** it.

It's Roblox's `Players.PlayerAdded:Connect(fn)`, with `-=` in place of `:Disconnect()`. The method must take the same
inputs the event gives (here, one `ulong` client id).

Always unsubscribe when your object is destroyed. Otherwise the NetworkManager, which outlives the scene, keeps calling
a method on an object that's gone.

### Step 3.3: knowing when you're in

Subscribe in `Start`. `NetworkManager.Singleton` is set up during its own Awake, so Start is the first safe place:

```csharp
    private void Start()
    {
        NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
    }

    private void OnDestroy()
    {
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientConnectedCallback -= OnClientConnected;
        }
    }

    private void OnClientConnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
        {
            ShowHud();
        }
    }

    private void ShowHud()
    {
        mainMenu.SetActive(false);
        hud.SetActive(true);
    }
```

What each piece does:
- **`OnClientConnected(ulong clientId)`** is called on your machine. On the host it's called once for every client
  that connects, so it checks **whether it's you**: `clientId == LocalClientId`. Only then is the menu's job done.
- **`ShowHud`** collects the two lines we keep repeating. Make `OnHostClicked` call `ShowHud()` too.
- **The `!= null` check in `OnDestroy`:** when you stop playing, the NetworkManager may be destroyed first, so we only
  unsubscribe if it still exists.

Now a "please wait" state, so a slow join doesn't look broken. Add a status text field:

```csharp
    [SerializeField] private TMP_Text statusText;
```

and change `OnJoinClicked` to say what's happening and stop double clicks:

```csharp
    private void OnJoinClicked()
    {
        string address = string.IsNullOrWhiteSpace(addressField.text) ? "127.0.0.1" : addressField.text.Trim();
        Transport.SetConnectionData(address, port);
        SetButtonsInteractable(false);   // no double clicks while we wait
        statusText.text = "Connecting to " + address + "...";
        NetworkManager.Singleton.StartClient();
    }

    private void SetButtonsInteractable(bool isInteractable)
    {
        hostButton.interactable = isInteractable;
        joinButton.interactable = isInteractable;
    }
```

`interactable = false` greys a button out and makes it ignore clicks: step 4 in the life of a click.

**Hook it up:** drag `StatusText` into its slot.

**Try it:** host in one window and join in the other. Player 2 shows "Connecting..." for a moment, then its menu
vanishes.

### Step 3.4: falling back to the menu

When a client's connection fails, or the host quits, `OnClientDisconnectCallback` fires on that client. Subscribe to it
next to the other event, in `Start` and `OnDestroy`:

```csharp
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;   // in Start
        NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;   // in OnDestroy
```

```csharp
    // On a client: fired when connecting fails, it's kicked, or the host quits. On the host it fires for each client
    // that leaves, which is not the menu's business.
    private void OnClientDisconnected(ulong clientId)
    {
        NetworkManager manager = NetworkManager.Singleton;
        if (manager.IsServer)
        {
            return;
        }
        string reason = string.IsNullOrEmpty(manager.DisconnectReason) ? "Disconnected." : manager.DisconnectReason;
        ShowMenu(reason);
    }

    private void ShowMenu(string status)
    {
        mainMenu.SetActive(true);
        hud.SetActive(false);
        statusText.text = status;
        SetButtonsInteractable(true);
    }
```

What each piece does:
- **`manager.IsServer`** is true on the host. The host hears about every client that leaves, and that shouldn't throw
  the host back to its menu.
- **`manager.DisconnectReason`** is a message the host can send when it rejects someone. It's often empty, hence the
  fallback text.
- **`ShowMenu`** is the reverse of `ShowHud`. Call `ShowMenu(string.Empty)` at the end of `Start` too, so the menu
  always starts in a clean state.

If `StartHost` or `StartClient` returns `false`, show the menu with a message too. The finished `OnHostClicked` and
`OnJoinClicked` below do this.

### Step 3.5: the cursor

Your player script will **lock** the cursor to the middle of the screen for mouse-look. A locked cursor can't click
anything, so the menu unlocks it and the HUD locks it again. Add these lines at the end of `ShowMenu` and `ShowHud`:

```csharp
        // in ShowMenu
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;

        // in ShowHud
        Cursor.lockState = CursorLockMode.Locked;
```

### The whole `MenuUI.cs` so far

```csharp
using TMPro;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.UI;

public class MenuUI : MonoBehaviour
{
    [SerializeField] private GameObject mainMenu;
    [SerializeField] private GameObject hud;
    [SerializeField] private Button hostButton;
    [SerializeField] private Button joinButton;
    [SerializeField] private TMP_InputField addressField;
    [SerializeField] private TMP_Text statusText;
    [SerializeField] private ushort port = 7777;

    // Code-wired buttons: add in OnEnable, remove in OnDisable, so toggling this object never doubles them.
    private void OnEnable()
    {
        hostButton.onClick.AddListener(OnHostClicked);
        joinButton.onClick.AddListener(OnJoinClicked);
    }

    private void OnDisable()
    {
        hostButton.onClick.RemoveListener(OnHostClicked);
        joinButton.onClick.RemoveListener(OnJoinClicked);
    }

    // NetworkManager.Singleton exists from its own Awake, so Start is the first safe place to subscribe.
    private void Start()
    {
        NetworkManager.Singleton.OnClientConnectedCallback += OnClientConnected;
        NetworkManager.Singleton.OnClientDisconnectCallback += OnClientDisconnected;
        ShowMenu(string.Empty);
    }

    private void OnDestroy()
    {
        if (NetworkManager.Singleton != null)
        {
            NetworkManager.Singleton.OnClientConnectedCallback -= OnClientConnected;
            NetworkManager.Singleton.OnClientDisconnectCallback -= OnClientDisconnected;
        }
    }

    private UnityTransport Transport => (UnityTransport)NetworkManager.Singleton.NetworkConfig.NetworkTransport;

    private void OnHostClicked()
    {
        // Listen on every network card ("0.0.0.0"), so players on your LAN can reach you, not just this PC.
        Transport.SetConnectionData("127.0.0.1", port, "0.0.0.0");
        if (!NetworkManager.Singleton.StartHost())
        {
            ShowMenu("Couldn't host. Is another copy already hosting on this port?");
            return;
        }
        ShowHud();   // the host is connected the moment it starts
    }

    private void OnJoinClicked()
    {
        string address = string.IsNullOrWhiteSpace(addressField.text) ? "127.0.0.1" : addressField.text.Trim();
        Transport.SetConnectionData(address, port);
        SetButtonsInteractable(false);   // no double clicks while we wait
        statusText.text = "Connecting to " + address + "...";
        if (!NetworkManager.Singleton.StartClient())
        {
            ShowMenu("Couldn't start the client.");
        }
        // Starting isn't connecting: we only know it worked when OnClientConnected fires for us.
    }

    private void OnClientConnected(ulong clientId)
    {
        if (clientId == NetworkManager.Singleton.LocalClientId)
        {
            ShowHud();
        }
    }

    // Fires on a client when it fails to connect, is kicked, or the host quits. On the host it fires for each client
    // that leaves, which is not our problem.
    private void OnClientDisconnected(ulong clientId)
    {
        NetworkManager manager = NetworkManager.Singleton;
        if (manager.IsServer)
        {
            return;
        }
        string reason = string.IsNullOrEmpty(manager.DisconnectReason) ? "Disconnected." : manager.DisconnectReason;
        ShowMenu(reason);
    }

    private void ShowMenu(string status)
    {
        mainMenu.SetActive(true);
        hud.SetActive(false);
        statusText.text = status;
        SetButtonsInteractable(true);
        Cursor.lockState = CursorLockMode.None;   // a locked cursor can't click anything
        Cursor.visible = true;
    }

    private void ShowHud()
    {
        mainMenu.SetActive(false);
        hud.SetActive(true);
        Cursor.lockState = CursorLockMode.Locked;
    }

    private void SetButtonsInteractable(bool isInteractable)
    {
        hostButton.interactable = isInteractable;
        joinButton.interactable = isInteractable;
    }
}
```

**Try all of it:**
1. Host, then join: both menus vanish.
2. Stop Play in the host window: Player 2 returns to its menu with a reason.
3. Join with no host running: "Connecting..." for a while, then back to the menu.

If a click does nothing:
- Is there exactly one EventSystem?
- Is the cursor unlocked?
- Is something with Raycast Target on lying over the button?
- Are all the slots filled? An empty slot throws a NullReferenceException as soon as you press Play.

---

## 4. Your player

### The idea: every machine runs every script

When two players are in a session, **each machine has a copy of both players**, and every copy runs the same scripts.
So in your player script, the first question is always: *is this copy mine?*

- **`IsOwner`** is true only on the copy you control. Read input and move only when it's true.
- **The NetworkTransform** on the prefab is set to **Owner authority**: the owner's machine sends its position, and
  every other machine smoothly follows it (it **interpolates**). So you move your copy, and the others just display it.
- **`OnNetworkSpawn()`** runs when the object has joined the network. `IsOwner` and the other network facts are only
  correct from here on, never in `Awake` or `Start`.

The prefab (`Assets/Prefabs/Player`) already has a CharacterController, a NetworkObject, the NetworkTransform (Owner,
syncing position and yaw), a blue body, a yellow nose, and a `ViewCamera` child with its Camera and AudioListener
switched **off**.

### Step 4.1: only my camera turns on

Create `Assets/Scripts/PlayerMotor.cs`:

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
public class PlayerMotor : NetworkBehaviour
{
    [SerializeField] private Camera viewCamera;

    public override void OnNetworkSpawn()
    {
        viewCamera.enabled = IsOwner;
        viewCamera.GetComponent<AudioListener>().enabled = IsOwner;
    }
}
```

What each piece does:
- **`NetworkBehaviour`** instead of `MonoBehaviour` gives the script network powers: `IsOwner`, `IsServer`,
  `OnNetworkSpawn`, RPCs.
- **`[RequireComponent(typeof(CharacterController))]`** makes Unity insist the object has a CharacterController.
- **`viewCamera.enabled = IsOwner`** turns the camera on in your copy and leaves it off in everyone else's. Without it,
  every machine would look through whichever player camera spawned last.

**Hook it up:** open the Player prefab (double-click it), Add Component > PlayerMotor, and drag `ViewCamera` into
**View Camera**. Save the prefab.

**Try it:** host and join. Each window now looks out of its own player's eyes.

### Step 4.2: looking around

Add fields and state:

```csharp
    [SerializeField] private float lookSensitivity = 0.1f;

    private float yaw;     // left and right, turns the whole body
    private float pitch;   // up and down, tilts only the camera
```

In `OnNetworkSpawn`, after the camera lines:

```csharp
        if (IsOwner)
        {
            yaw = transform.eulerAngles.y;
        }
```

Then an `Update` that only the owner gets past:

```csharp
    private void Update()
    {
        if (!IsOwner)
        {
            return;
        }
        Look();
    }

    private void Look()
    {
        Vector2 look = Mouse.current.delta.ReadValue() * lookSensitivity;
        yaw += look.x;
        pitch = Mathf.Clamp(pitch - look.y, -85f, 85f);
        transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        viewCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
    }
```

What each piece does:
- **`if (!IsOwner) return;`** is the single most important line in multiplayer code. Every copy runs `Update`, but only
  your copy reads your mouse.
- **`Mouse.current.delta`** is how far the mouse moved this frame (Input System).
- **Yaw turns the body; pitch tilts the camera.** The NetworkTransform syncs only the body's yaw, so other players see
  you turn, but your head tilt stays local.
- **`Mathf.Clamp(..., -85, 85)`** stops you looking past straight up or down.

**Try it:** you can look around. MenuUI's `ShowHud` already locks the cursor.

### The idea: how a CharacterController moves

A CharacterController is a capsule you move by calling **`Move(distance)`** once a frame:
- It slides along walls, steps up ledges lower than its **step offset** (0.4 m on this prefab), and walks up slopes
  gentler than its **slope limit** (45°).
- **Physics never moves it**, and **it has no gravity**. You keep your own vertical speed and add gravity each frame.
- `Move` takes a **distance**, so you multiply a speed (metres per second) by `Time.deltaTime` (seconds this frame).
- After each `Move`, **`isGrounded`** tells you whether it ended up standing on something.

### Step 4.3: walking and sprinting

Fields, plus a reference to the controller:

```csharp
    [SerializeField] private float walkSpeed = 5f;
    [SerializeField] private float sprintSpeed = 8f;

    private CharacterController controller;

    private void Awake()
    {
        controller = GetComponent<CharacterController>();
    }
```

`Awake` is fine here because finding a component on the same object isn't a network question.

Call `Move()` after `Look()` in `Update`, and add the method:

```csharp
    private void Move()
    {
        Keyboard keyboard = Keyboard.current;
        float right = (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f);
        float forward = (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f);
        float speed = keyboard.leftShiftKey.isPressed ? sprintSpeed : walkSpeed;
        Vector3 wish = Vector3.ClampMagnitude(transform.forward * forward + transform.right * right, 1f) * speed;

        controller.Move(wish * Time.deltaTime);
    }
```

What each piece does:
- **`right` and `forward`** become -1, 0 or 1 from the keys.
- **`transform.forward` and `transform.right`** are the directions your body faces, so W moves where you look.
- **`ClampMagnitude(..., 1)`** stops diagonal movement being faster than straight (otherwise W+D would be about 1.4 times
  speed).

**Try it:** walk around in both windows and watch each other move smoothly. Walk up the 0.3 m step without jumping.
The others need the jump from the next step.

### Step 4.4: gravity and jumping

```csharp
    [SerializeField] private float jumpHeight = 1.2f;
    [SerializeField] private float gravity = -20f;

    private float verticalSpeed;
```

Replace the single `controller.Move(...)` line at the end of `Move()` with:

```csharp
        // isGrounded comes from the last Move. Keep pressing down slightly while grounded, or it flickers on slopes.
        if (controller.isGrounded && verticalSpeed < 0f)
        {
            verticalSpeed = -2f;
        }
        if (controller.isGrounded && keyboard.spaceKey.wasPressedThisFrame)
        {
            // The launch speed that peaks at exactly jumpHeight: v = sqrt(2 * h * g).
            verticalSpeed = Mathf.Sqrt(2f * jumpHeight * -gravity);
        }
        verticalSpeed += gravity * Time.deltaTime;

        Vector3 velocity = wish + Vector3.up * verticalSpeed;
        CollisionFlags hits = controller.Move(velocity * Time.deltaTime);
        if ((hits & CollisionFlags.Above) != 0 && verticalSpeed > 0f)
        {
            verticalSpeed = 0f;   // bonked our head
        }
```

What each piece does:
- **Gravity** makes `verticalSpeed` 20 m/s more negative every second, so you fall faster and faster, like real
  falling.
- **The `-2` while grounded** keeps you pressed onto the floor. With exactly 0, `isGrounded` flickers off on slopes and
  jumps get eaten.
- **`wasPressedThisFrame`** is true only on the frame the key goes down, so holding Space doesn't machine-gun jumps.
- **The jump speed formula** gives exactly the height you asked for: jumpHeight 1.2 really lifts you 1.2 m.
- **`Move` returns `CollisionFlags`**: which sides you hit. If you hit something **above** while rising, your upward
  speed stops, so you don't stick to the ceiling.

**Try it:** jump onto the 0.6 and 1.0 m steps (the 1.4 m one is too high), try the low ceiling, and slide off the 55°
ramp.

### Step 4.5: the cursor on spawn

Lock the cursor for your own player when it spawns (the host's player spawns the moment it hosts). Add to
`OnNetworkSpawn`, inside the `IsOwner` block:

```csharp
            Cursor.lockState = CursorLockMode.Locked;
```

---

## 5. Being pushed by the host

### The idea: RPCs, and why only you can move you

An **RPC** (remote procedure call) is a method you call on one machine that runs on another, like a RemoteEvent you
call as a method. In NGO you mark it with an attribute, and the method name must end in `Rpc`:

```csharp
[Rpc(SendTo.Server)]   // runs on the host, called from anywhere: a request
[Rpc(SendTo.Owner)]    // runs on the object's owner
[Rpc(SendTo.Everyone)] // runs on every machine, including the one that called it
```

An RPC can take a final `RpcParams rpcParams = default` parameter. Inside the RPC, `rpcParams.Receive.SenderClientId`
tells you **who really sent it**. Trust that, never an id the sender puts in the message.

Why this matters for pushing: your player is moved by **your** machine (rule 2). If the host just set your position,
your machine would overwrite it on the very next frame. So when the host wants to knock you back, it calls an RPC that
runs **on your machine** ("apply this push"), and your machine adds it to its own movement.

### Step 5.1: room for outside forces

Add to PlayerMotor:

```csharp
    [Tooltip("How quickly a push fades, per second. Higher stops sooner.")]
    [SerializeField] private float pushDrag = 3f;

    private Vector3 pushVelocity;
    private float stunnedUntil;
```

In `Move()`, read movement keys only while not stunned, add the push to the velocity, and fade it each frame:

```csharp
        bool isStunned = Time.time < stunnedUntil;
        // ... build `wish` only when !isStunned (see the full listing), and only jump when !isStunned

        Vector3 velocity = wish + pushVelocity + Vector3.up * verticalSpeed;
        CollisionFlags hits = controller.Move(velocity * Time.deltaTime);
        pushVelocity *= Mathf.Exp(-pushDrag * Time.deltaTime);   // pushes fade out smoothly instead of stopping dead
```

`Mathf.Exp(-drag * dt)` shrinks the push by the same share every second whatever the frame rate, so it fades the same
at 30 and 144 fps.

### Step 5.2: the push itself

```csharp
    /// <summary>Server only: knock this player back. Only its owner can move it, so the push is sent there.</summary>
    public void ServerPush(Vector3 velocity, float stunSeconds)
    {
        if (IsServer)
        {
            PushRpc(velocity, stunSeconds);
        }
    }

    [Rpc(SendTo.Owner)]
    private void PushRpc(Vector3 velocity, float stunSeconds, RpcParams rpcParams = default)
    {
        // Only the server may push people; anything else is a cheat or a bug.
        if (rpcParams.Receive.SenderClientId != NetworkManager.ServerClientId)
        {
            return;
        }
        pushVelocity += new Vector3(velocity.x, 0f, velocity.z);
        verticalSpeed = Mathf.Max(verticalSpeed, velocity.y);
        stunnedUntil = Mathf.Max(stunnedUntil, Time.time + stunSeconds);
    }
```

What each piece does:
- **`ServerPush`** is the public door: any host-side code (a blast, a thrown box) calls it. It checks `IsServer`, so a
  client calling it by mistake does nothing.
- **`PushRpc`** runs on the owner's machine and checks that the sender was the server.
- **Sideways push** goes into `pushVelocity`; **upward push** lifts `verticalSpeed`, so gravity brings you back down.
- **`Mathf.Max` on the stun** means a short stun never cuts a longer one short.

### Step 5.3: teleporting

A CharacterController remembers where it is. If you set `transform.position` while it's on, its next `Move` snaps you
back. So turn it off around the jump:

```csharp
    /// <summary>Owner only: jump straight to a point (a respawn). The controller must be off, or it snaps back.</summary>
    public void TeleportOwner(Vector3 position)
    {
        controller.enabled = false;
        transform.position = position;
        controller.enabled = true;
    }
```

### The whole `PlayerMotor.cs` so far

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
public class PlayerMotor : NetworkBehaviour
{
    [SerializeField] private Camera viewCamera;
    [SerializeField] private float walkSpeed = 5f;
    [SerializeField] private float sprintSpeed = 8f;
    [SerializeField] private float jumpHeight = 1.2f;
    [SerializeField] private float gravity = -20f;
    [SerializeField] private float lookSensitivity = 0.1f;
    [Tooltip("How quickly a push fades, per second. Higher stops sooner.")]
    [SerializeField] private float pushDrag = 3f;

    private CharacterController controller;
    private float yaw;
    private float pitch;
    private float verticalSpeed;
    private Vector3 pushVelocity;
    private float stunnedUntil;

    public Camera ViewCamera => viewCamera;
    public float EyeHeight => viewCamera.transform.localPosition.y;

    private void Awake()
    {
        controller = GetComponent<CharacterController>();
    }

    // IsOwner and NetworkVariables are only valid from here on, never in Awake or Start.
    public override void OnNetworkSpawn()
    {
        viewCamera.enabled = IsOwner;
        viewCamera.GetComponent<AudioListener>().enabled = IsOwner;
        if (IsOwner)
        {
            yaw = transform.eulerAngles.y;
            Cursor.lockState = CursorLockMode.Locked;
        }
    }

    private void Update()
    {
        // Every machine runs this script; only the owner drives its player. The other copies are moved by the
        // NetworkTransform, and their CharacterController stays enabled so they still have a collider (section 6).
        if (!IsOwner)
        {
            return;
        }

        Look();
        Move();
    }

    private void Look()
    {
        Vector2 look = Mouse.current.delta.ReadValue() * lookSensitivity;
        yaw += look.x;
        pitch = Mathf.Clamp(pitch - look.y, -85f, 85f);
        transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        viewCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
    }

    private void Move()
    {
        Keyboard keyboard = Keyboard.current;
        bool isStunned = Time.time < stunnedUntil;

        Vector3 wish = Vector3.zero;
        if (!isStunned)
        {
            float right = (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f);
            float forward = (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f);
            float speed = keyboard.leftShiftKey.isPressed ? sprintSpeed : walkSpeed;
            wish = Vector3.ClampMagnitude(transform.forward * forward + transform.right * right, 1f) * speed;
        }

        // isGrounded comes from the last Move. Keep pressing down slightly while grounded, or it flickers on slopes.
        if (controller.isGrounded && verticalSpeed < 0f)
        {
            verticalSpeed = -2f;
        }
        if (!isStunned && controller.isGrounded && keyboard.spaceKey.wasPressedThisFrame)
        {
            // The launch speed that peaks at exactly jumpHeight: v = sqrt(2 * h * g).
            verticalSpeed = Mathf.Sqrt(2f * jumpHeight * -gravity);
        }
        verticalSpeed += gravity * Time.deltaTime;

        // Walking, plus whatever is pushing us, plus gravity. Move takes a distance, so scale by deltaTime.
        Vector3 velocity = wish + pushVelocity + Vector3.up * verticalSpeed;
        CollisionFlags hits = controller.Move(velocity * Time.deltaTime);

        // Pushes fade out smoothly instead of stopping dead.
        pushVelocity *= Mathf.Exp(-pushDrag * Time.deltaTime);
        if ((hits & CollisionFlags.Above) != 0 && verticalSpeed > 0f)
        {
            verticalSpeed = 0f;   // bonked our head
        }
    }

    // ---- The outside-forces layer: every push in the game comes through here ----

    /// <summary>Server only: knock this player back. Only its owner can move it, so the push is sent there.</summary>
    public void ServerPush(Vector3 velocity, float stunSeconds)
    {
        if (IsServer)
        {
            PushRpc(velocity, stunSeconds);
        }
    }

    [Rpc(SendTo.Owner)]
    private void PushRpc(Vector3 velocity, float stunSeconds, RpcParams rpcParams = default)
    {
        // Only the server may push people; anything else is a cheat or a bug.
        if (rpcParams.Receive.SenderClientId != NetworkManager.ServerClientId)
        {
            return;
        }
        pushVelocity += new Vector3(velocity.x, 0f, velocity.z);
        verticalSpeed = Mathf.Max(verticalSpeed, velocity.y);
        stunnedUntil = Mathf.Max(stunnedUntil, Time.time + stunSeconds);
    }

    /// <summary>
    /// Owner only: jump straight to a point (a respawn, being dropped out of something). A CharacterController
    /// snaps back if you set transform.position while it's on, so turn it off around the move.
    /// </summary>
    public void TeleportOwner(Vector3 position)
    {
        controller.enabled = false;
        transform.position = position;
        controller.enabled = true;
    }
}
```

`ViewCamera` and `EyeHeight` at the top are read-only shortcuts that the hands script in section 7 needs.

### Step 5.4: a test blast

Create `Assets/Scripts/TestBlast.cs` and put it on any Cube, after adding a **NetworkObject** to that Cube:

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

public class TestBlast : NetworkBehaviour
{
    [SerializeField] private float radius = 5f;
    [SerializeField] private float strength = 14f;

    private void Update()
    {
        if (!IsServer || !Keyboard.current.bKey.wasPressedThisFrame)
        {
            return;
        }

        foreach (NetworkClient client in NetworkManager.ConnectedClientsList)
        {
            if (client.PlayerObject == null)
            {
                continue;
            }
            Vector3 offset = client.PlayerObject.transform.position - transform.position;
            float falloff = 1f - offset.magnitude / radius;
            if (falloff <= 0f)
            {
                continue;
            }
            Vector3 push = (new Vector3(offset.x, 0f, offset.z).normalized + Vector3.up) * strength * falloff;
            client.PlayerObject.GetComponent<PlayerMotor>().ServerPush(push, 0.5f);
        }
    }
}
```

- **`if (!IsServer ...)`**: only the host runs the blast. That's rule 1.
- **`NetworkManager.ConnectedClientsList`** is the host's list of everyone connected, and `client.PlayerObject` is each
  one's player.
- **`falloff`** is 1 at the centre and 0 at the edge, so near players fly further.

**Try it:** stand players near the cube and press **B** in the host window. In the client window the push arrives a
moment after the host's. That delay is the trip to the owner.

---

## 6. Remote players need a collider on the host

### The idea

Thrown boxes should hit players, and the host should be able to ask "is anyone standing here?". Both need every
player to have a collider **on the host's machine**, including the players the host doesn't control.

That's why `PlayerMotor` never turns the CharacterController off on other people's copies: only the owner calls
`Move`, but every copy keeps its controller enabled, so it acts as a solid capsule. Thrown boxes bounce off remote
players, `Physics.OverlapCapsule` finds them, and players bump into each other. (You can't shove someone by walking
into them. Pushing is a server decision, section 5.)

No code here: it's a decision already in the code you wrote. Understanding it saves you a confusing bug later.

---

## 7. Picking up and throwing

### The idea: shared state, and handing a box to a player

Three ideas meet here.

**1. NetworkVariables are shared state.**
- A `NetworkVariable<T>` is a value the host writes and every machine reads, late joiners included.
- `OnValueChanged` tells you when it changes.
- We use one for "who's holding this box". RPCs suit moments; a holder is state.

**2. Ownership moves.**
- A box at rest belongs to the host, which simulates its physics.
- When you pick it up, the host hands **ownership** to you (`ChangeOwnership`), so you can move it to your hands with
  zero lag.
- When you throw it, the host takes it back (`RemoveOwnership`) and simulates the flight itself. That's rule 3.

**3. Requests are checked.**
- You ask "may I pick up this box?" with an RPC, and the host checks before saying yes: is it free, are you close
  enough, are your hands empty?
- The client only ever sends **what it wants**, never a result or a position.

How a pick-up and a throw travel:

```
Client                                   Host (server)
  sees a box under the crosshair
  presses E
  PickUpRpc(box)  ────────────────────►  is it free? in reach? hands empty?
                                          yes: holder = client   (NetworkVariable)
                                               ChangeOwnership(client)
  owns the box now  ◄──────────────────
  moves it to the hands each frame
  (its NetworkTransform shows everyone)
  clicks
  ThrowRpc(aim)  ──────────────────────►  carrying? aim is a real direction?
                                          yes: holder = none, RemoveOwnership()
                                               places it, sets its velocity
                                               simulates the flight itself
```

The Box prefab is premade: a 0.5 m cube with a Rigidbody (Continuous Dynamic), a NetworkObject with **Dont Destroy With
Owner** ticked (so the box survives its carrier leaving), and a NetworkTransform on Owner authority.

### Step 7.1: the box knows who holds it

Create `Assets/Scripts/Grabbable.cs`:

```csharp
using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class Grabbable : NetworkBehaviour
{
    public const ulong NoHolder = ulong.MaxValue;

    private static readonly List<Grabbable> all = new List<Grabbable>();

    private readonly NetworkVariable<ulong> holder = new NetworkVariable<ulong>(NoHolder);

    public bool IsHeld => holder.Value != NoHolder;

    public static Grabbable FindHeldBy(ulong clientId)
    {
        foreach (Grabbable item in all)
        {
            if (item.holder.Value == clientId)
            {
                return item;
            }
        }
        return null;
    }

    public override void OnNetworkSpawn()
    {
        all.Add(this);
    }

    public override void OnNetworkDespawn()
    {
        all.Remove(this);
    }
}
```

What each piece does:
- **`holder`** is the NetworkVariable: a client id, or `NoHolder` when nobody holds it. Only the host writes it (the
  default), and every machine reads it.
- **`NoHolder = ulong.MaxValue`**: client ids start at 0, so 0 can't mean "nobody". The biggest possible number is
  safely unused.
- **`all`** is a list of every box, shared by the class (`static`). Each box adds itself when it spawns and removes
  itself when it despawns. `FindHeldBy` searches it: "which box is this player holding?"

**Hook it up:** open the Box prefab and Add Component > Grabbable. The six scene boxes are instances, so they all get it.

### Step 7.2: physics follows ownership

The body must be simulated only on the box's owner, and only while nobody carries it. Add:

```csharp
    private Rigidbody body;
    private Collider[] colliders;

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
        colliders = GetComponentsInChildren<Collider>();
    }

    // Physics follows ownership: dynamic only on the owner and only while nobody carries it. Colliders are off while
    // carried so the box never shoves its own carrier.
    private void RefreshBody()
    {
        bool isCarried = IsHeld;
        bool shouldSimulate = IsOwner && !isCarried;
        if (body.isKinematic == shouldSimulate)
        {
            body.isKinematic = !shouldSimulate;
        }
        foreach (Collider part in colliders)
        {
            part.enabled = !isCarried;
        }
    }
```

- **`isKinematic = true`** means physics leaves the body alone and something else sets its position. On every
  non-owner, the NetworkTransform does that.
- **Colliders off while carried**, so the box floating in front of you doesn't push you or anyone else around.

When should `RefreshBody` run? Whenever the holder or the owner changes. Those arrive as **two separate messages, in
either order**, so the simplest correct answer is: on the change, and every frame as well. Subscribe in
`OnNetworkSpawn`, unsubscribe in `OnNetworkDespawn`, and add an `Update`:

```csharp
        holder.OnValueChanged += OnHolderChanged;   // in OnNetworkSpawn, then call RefreshBody();
        holder.OnValueChanged -= OnHolderChanged;   // in OnNetworkDespawn

    private void OnHolderChanged(ulong previous, ulong current)
    {
        RefreshBody();
    }

    private void Update()
    {
        if (IsSpawned)
        {
            RefreshBody();
        }
    }
```

`OnValueChanged` hands you the old and new values; we only need to know that it changed.

### Step 7.3: the host hands it over and takes it back

These two methods only ever run on the host (they're called from checked RPCs in step 7.6):

```csharp
    private bool isInFlight;

    /// <summary>Server only: hand it to a player. The caller has already checked reach and that it's free.</summary>
    public void ServerPickUp(ulong clientId)
    {
        isInFlight = false;
        holder.Value = clientId;
        NetworkObject.ChangeOwnership(clientId);
    }

    /// <summary>Server only: take it back from its carrier and launch it. The server simulates the flight.</summary>
    public void ServerThrow(Vector3 startPosition, Vector3 velocity)
    {
        holder.Value = NoHolder;
        NetworkObject.RemoveOwnership();
        RefreshBody();
        transform.position = startPosition;
        body.linearVelocity = velocity;
        isInFlight = true;
    }
```

- **`holder.Value = clientId`** writes the NetworkVariable. NGO sends it to everyone.
- **`ChangeOwnership(clientId)`** makes that player the owner, so their NetworkTransform now drives the box.
- **`RemoveOwnership()`** gives it back to the host. `RefreshBody()` right away makes the body dynamic again on the
  host, before the velocity is set.

### Step 7.4: hits knock players back

```csharp
    // The server's own physics decides hits; a client never reports one. A thrown box that hits a player knocks
    // them back, through that player's owner.
    private void OnCollisionEnter(Collision collision)
    {
        if (!IsServer || !isInFlight)
        {
            return;
        }
        isInFlight = false;
        PlayerMotor player = collision.collider.GetComponentInParent<PlayerMotor>();
        if (player != null)
        {
            player.ServerPush(body.linearVelocity * 0.6f + Vector3.up * 3f, 0.4f);
        }
    }
```

Only the host checks, because only the host simulates a thrown box. The first thing it hits ends the flight. If that
was a player, they're pushed through section 5's door.

### The whole `Grabbable.cs` so far

```csharp
using System.Collections.Generic;
using Unity.Netcode;
using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class Grabbable : NetworkBehaviour
{
    public const ulong NoHolder = ulong.MaxValue;

    private static readonly List<Grabbable> all = new List<Grabbable>();

    // Server-written, synced to everyone (late joiners too): who is carrying this.
    private readonly NetworkVariable<ulong> holder = new NetworkVariable<ulong>(NoHolder);

    private Rigidbody body;
    private Collider[] colliders;
    private bool isInFlight;

    public bool IsHeld => holder.Value != NoHolder;

    public static Grabbable FindHeldBy(ulong clientId)
    {
        foreach (Grabbable item in all)
        {
            if (item.holder.Value == clientId)
            {
                return item;
            }
        }
        return null;
    }

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
        colliders = GetComponentsInChildren<Collider>();
    }

    public override void OnNetworkSpawn()
    {
        all.Add(this);
        holder.OnValueChanged += OnHolderChanged;
        RefreshBody();
    }

    // Anything subscribed in OnNetworkSpawn is unsubscribed here, or it fires on a dead object.
    public override void OnNetworkDespawn()
    {
        all.Remove(this);
        holder.OnValueChanged -= OnHolderChanged;
    }

    private void OnHolderChanged(ulong previous, ulong current)
    {
        RefreshBody();
    }

    // The holder change and the ownership change are separate messages that can arrive in either order, so this
    // also runs every frame and settles whatever order they came in.
    private void Update()
    {
        if (IsSpawned)
        {
            RefreshBody();
        }
    }

    // Physics follows ownership: dynamic only on the owner and only while nobody carries it. Colliders are off while
    // carried so the box never shoves its own carrier.
    private void RefreshBody()
    {
        bool isCarried = IsHeld;
        bool shouldSimulate = IsOwner && !isCarried;
        if (body.isKinematic == shouldSimulate)
        {
            body.isKinematic = !shouldSimulate;
        }
        foreach (Collider part in colliders)
        {
            part.enabled = !isCarried;
        }
    }

    /// <summary>Server only: hand it to a player. The caller has already checked reach and that it's free.</summary>
    public void ServerPickUp(ulong clientId)
    {
        isInFlight = false;
        holder.Value = clientId;
        NetworkObject.ChangeOwnership(clientId);
    }

    /// <summary>Server only: take it back from its carrier and launch it. The server simulates the flight.</summary>
    public void ServerThrow(Vector3 startPosition, Vector3 velocity)
    {
        holder.Value = NoHolder;
        NetworkObject.RemoveOwnership();
        RefreshBody();
        transform.position = startPosition;
        body.linearVelocity = velocity;
        isInFlight = true;
    }

    // The server's own physics decides hits; a client never reports one. A thrown box that hits a player knocks
    // them back, through that player's owner.
    private void OnCollisionEnter(Collision collision)
    {
        if (!IsServer || !isInFlight)
        {
            return;
        }
        isInFlight = false;
        PlayerMotor player = collision.collider.GetComponentInParent<PlayerMotor>();
        if (player != null)
        {
            player.ServerPush(body.linearVelocity * 0.6f + Vector3.up * 3f, 0.4f);
        }
    }
}
```

### Step 7.5: hands that can see

Create `Assets/Scripts/PlayerHands.cs`. First it just looks for a free box under the crosshair, and remembers what it
saw, so the HUD can show it later:

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerHands : NetworkBehaviour
{
    [SerializeField] private PlayerMotor motor;
    [SerializeField] private float reach = 2.5f;

    public static PlayerHands Local { get; private set; }
    public bool IsCarrying { get; private set; }
    public Grabbable LookedAtItem { get; private set; }

    public override void OnNetworkSpawn()
    {
        if (IsOwner)
        {
            Local = this;
        }
    }

    public override void OnNetworkDespawn()
    {
        if (Local == this)
        {
            Local = null;
        }
    }

    private void Update()
    {
        if (!IsOwner)
        {
            return;
        }

        Transform view = motor.ViewCamera.transform;
        IsCarrying = Grabbable.FindHeldBy(OwnerClientId) != null;
        LookedAtItem = null;

        if (!IsCarrying && Physics.Raycast(view.position, view.forward, out RaycastHit hit, reach, ~0, QueryTriggerInteraction.Ignore))
        {
            Grabbable target = hit.collider.GetComponentInParent<Grabbable>();
            if (target != null && !target.IsHeld)
            {
                LookedAtItem = target;
            }
        }
    }
}
```

What each piece does:
- **`Local`** is a shortcut to *your own* hands on this machine. It's static (one for the whole game), set when your
  player spawns and cleared when it despawns. The HUD uses it.
- **`{ get; private set; }`** means other scripts can read these properties but only this script can change them.
- **`Physics.Raycast`** shoots an invisible line from your eyes along your view, up to `reach` metres. `out RaycastHit
  hit` fills in what it struck. `~0` means "every layer", and `QueryTriggerInteraction.Ignore` skips trigger volumes.
- **`GetComponentInParent<Grabbable>()`** checks the thing hit, and its parents, for a Grabbable, in case you hit a
  child part.

**Hook it up:** open the Player prefab, Add Component > PlayerHands, and drag the prefab's own **PlayerMotor** into the
**Motor** slot.

### Step 7.6: asking to pick it up

Now E sends a request. In `Update`, inside the `if (target != null && !target.IsHeld)` block, after `LookedAtItem =
target;`:

```csharp
                if (Keyboard.current.eKey.wasPressedThisFrame)
                {
                    PickUpRpc(target.NetworkObject);
                }
```

And the request, checked on the host:

```csharp
    [Tooltip("The server measures from the synced position, which lags the owner a little, so it allows this much more.")]
    [SerializeField] private float reachSlack = 1f;

    [Rpc(SendTo.Server)]
    private void PickUpRpc(NetworkObjectReference itemReference, RpcParams rpcParams = default)
    {
        ulong sender = rpcParams.Receive.SenderClientId;
        if (sender != OwnerClientId)
        {
            return;
        }
        if (!itemReference.TryGet(out NetworkObject itemObject) || !itemObject.TryGetComponent(out Grabbable item))
        {
            return;
        }
        if (item.IsHeld || Grabbable.FindHeldBy(sender) != null)
        {
            return;
        }
        Vector3 eyes = transform.position + Vector3.up * motor.EyeHeight;
        if (Vector3.Distance(eyes, item.transform.position) > reach + reachSlack)
        {
            return;
        }
        item.ServerPickUp(sender);
    }
```

What each check does, in order:
1. **`sender != OwnerClientId`**: only the player who owns these hands may use them. Otherwise a cheater could make
   *your* hands grab things.
2. **`NetworkObjectReference`**: you can't send a GameObject through an RPC, only a reference the other machine can look
   up. `TryGet` does the lookup, and fails if the box is gone.
3. **Free box, empty hands.**
4. **In reach, measured from where the host sees you.** The host's view of you is slightly behind your own, so it
   allows `reachSlack` extra.

If every check passes, the host hands the box over, and step 7.2's code does the rest on every machine.

### Step 7.7: holding it

While you hold the box you own it, so your machine places it at your hands each frame, and its NetworkTransform shows
everyone else:

```csharp
    [SerializeField] private float holdDistance = 1.2f;

    // LateUpdate runs after every Update, so the camera has already turned this frame and the box never lags the view.
    private void LateUpdate()
    {
        if (!IsOwner)
        {
            return;
        }
        Grabbable carried = Grabbable.FindHeldBy(OwnerClientId);
        if (carried != null && carried.IsOwner)
        {
            Transform view = motor.ViewCamera.transform;
            carried.transform.SetPositionAndRotation(view.position + view.forward * holdDistance, view.rotation);
        }
    }
```

`carried.IsOwner` checks that ownership has actually arrived, because the holder value can get here a moment before the
ownership does. Moving a box you don't own yet would just be overwritten.

**Try it:** host and join, look at a box, and press E. It jumps to your hands, and the other window sees it floating in
front of you.

### Step 7.8: throwing

Click to throw. Replace the start of `Update`'s carried check so a click while carrying sends a throw:

```csharp
        Grabbable carried = Grabbable.FindHeldBy(OwnerClientId);
        IsCarrying = carried != null;
        LookedAtItem = null;

        if (carried != null)
        {
            if (Mouse.current.leftButton.wasPressedThisFrame)
            {
                ThrowRpc(view.forward);   // only the aim crosses the network
            }
            return;
        }
```

And the request:

```csharp
    [SerializeField] private float throwSpeed = 14f;

    [Rpc(SendTo.Server)]
    private void ThrowRpc(Vector3 aim, RpcParams rpcParams = default)
    {
        ulong sender = rpcParams.Receive.SenderClientId;
        Grabbable item = Grabbable.FindHeldBy(sender);
        if (sender != OwnerClientId || item == null || float.IsNaN(aim.x + aim.y + aim.z) || aim.sqrMagnitude < 0.25f)
        {
            return;
        }
        aim.Normalize();
        Vector3 start = transform.position + Vector3.up * motor.EyeHeight + aim * holdDistance;
        item.ServerThrow(start, aim * throwSpeed + Vector3.up * 2f);
    }
```

- **Only the aim crosses the network.** The host decides where the box starts and how fast it goes, so a cheater can't
  send a speed of a million.
- **`float.IsNaN(...)` and `sqrMagnitude < 0.25`** reject broken or zero-length directions from a bad client.
- **`Normalize()`** makes the aim exactly 1 long, so `aim * throwSpeed` is exactly `throwSpeed` metres per second.

### The whole `PlayerHands.cs` so far

```csharp
using Unity.Netcode;
using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerHands : NetworkBehaviour
{
    [SerializeField] private PlayerMotor motor;
    [SerializeField] private float reach = 2.5f;
    [Tooltip("The server measures from the synced position, which lags the owner a little, so it allows this much more.")]
    [SerializeField] private float reachSlack = 1f;
    [SerializeField] private float holdDistance = 1.2f;
    [SerializeField] private float throwSpeed = 14f;

    /// <summary>My own hands on this machine (null until my player spawns), for the HUD.</summary>
    public static PlayerHands Local { get; private set; }

    /// <summary>Owner only: true while I carry something.</summary>
    public bool IsCarrying { get; private set; }

    /// <summary>Owner only: the free item under my crosshair, or null.</summary>
    public Grabbable LookedAtItem { get; private set; }

    public override void OnNetworkSpawn()
    {
        if (IsOwner)
        {
            Local = this;
        }
    }

    public override void OnNetworkDespawn()
    {
        if (Local == this)
        {
            Local = null;
        }
    }

    private void Update()
    {
        if (!IsOwner)
        {
            return;
        }

        Transform view = motor.ViewCamera.transform;
        Grabbable carried = Grabbable.FindHeldBy(OwnerClientId);
        IsCarrying = carried != null;
        LookedAtItem = null;

        if (carried != null)
        {
            if (Mouse.current.leftButton.wasPressedThisFrame)
            {
                ThrowRpc(view.forward);   // only the aim crosses the network
            }
            return;
        }

        if (Physics.Raycast(view.position, view.forward, out RaycastHit hit, reach, ~0, QueryTriggerInteraction.Ignore))
        {
            Grabbable target = hit.collider.GetComponentInParent<Grabbable>();
            if (target != null && !target.IsHeld)
            {
                LookedAtItem = target;
                if (Keyboard.current.eKey.wasPressedThisFrame)
                {
                    PickUpRpc(target.NetworkObject);
                }
            }
        }
    }

    // While I carry it I own it, so I place it at my hands myself; its NetworkTransform shows everyone else. LateUpdate
    // runs after the camera turned this frame, so the box never lags the view.
    private void LateUpdate()
    {
        if (!IsOwner)
        {
            return;
        }
        Grabbable carried = Grabbable.FindHeldBy(OwnerClientId);
        if (carried != null && carried.IsOwner)
        {
            Transform view = motor.ViewCamera.transform;
            carried.transform.SetPositionAndRotation(view.position + view.forward * holdDistance, view.rotation);
        }
    }

    // ---- Requests: the sender comes from the RPC, never from anything the client sends ----

    [Rpc(SendTo.Server)]
    private void PickUpRpc(NetworkObjectReference itemReference, RpcParams rpcParams = default)
    {
        ulong sender = rpcParams.Receive.SenderClientId;
        if (sender != OwnerClientId)
        {
            return;
        }
        if (!itemReference.TryGet(out NetworkObject itemObject) || !itemObject.TryGetComponent(out Grabbable item))
        {
            return;
        }
        if (item.IsHeld || Grabbable.FindHeldBy(sender) != null)
        {
            return;
        }
        Vector3 eyes = transform.position + Vector3.up * motor.EyeHeight;
        if (Vector3.Distance(eyes, item.transform.position) > reach + reachSlack)
        {
            return;
        }
        item.ServerPickUp(sender);
    }

    [Rpc(SendTo.Server)]
    private void ThrowRpc(Vector3 aim, RpcParams rpcParams = default)
    {
        ulong sender = rpcParams.Receive.SenderClientId;
        Grabbable item = Grabbable.FindHeldBy(sender);
        if (sender != OwnerClientId || item == null || float.IsNaN(aim.x + aim.y + aim.z) || aim.sqrMagnitude < 0.25f)
        {
            return;
        }
        aim.Normalize();
        Vector3 start = transform.position + Vector3.up * motor.EyeHeight + aim * holdDistance;
        item.ServerThrow(start, aim * throwSpeed + Vector3.up * 2f);
    }
}
```

**Try it:** pick up a box and throw it at the other player. It bounces off their capsule (section 6), and they get
knocked back (section 5).

### Step 7.9: the HUD

The HUD (`UI/HUD`: a crosshair, `HintText` and `InfoText`) has been empty so far. It **only reads** state: what your
hands see, how many players there are, your ping. It never changes the game. Create `Assets/Scripts/HudUI.cs`:

```csharp
using TMPro;
using Unity.Netcode;
using UnityEngine;

public class HudUI : MonoBehaviour
{
    [SerializeField] private TMP_Text hintText;
    [SerializeField] private TMP_Text infoText;

    private float nextInfoTime;

    // The HUD only reads state; it never changes the game. It runs only while the HUD object is active.
    private void Update()
    {
        PlayerHands hands = PlayerHands.Local;
        if (hands == null)
        {
            hintText.text = string.Empty;
        }
        else if (hands.IsCarrying)
        {
            hintText.text = "Click: throw";
        }
        else
        {
            hintText.text = hands.LookedAtItem != null ? "E: pick up" : string.Empty;
        }

        // Twice a second is plenty for numbers, and saves a scene search every frame.
        if (Time.unscaledTime >= nextInfoTime)
        {
            nextInfoTime = Time.unscaledTime + 0.5f;
            RefreshInfo();
        }
    }

    private void RefreshInfo()
    {
        NetworkManager manager = NetworkManager.Singleton;
        if (manager == null || !manager.IsListening)
        {
            infoText.text = string.Empty;
            return;
        }

        // Every machine has a copy of every player, so counting them works for host and clients alike.
        int players = FindObjectsByType<PlayerMotor>(FindObjectsSortMode.None).Length;
        if (manager.IsHost)
        {
            infoText.text = "Players: " + players + "   (hosting)";
            return;
        }
        ulong rtt = manager.NetworkConfig.NetworkTransport.GetCurrentRtt(NetworkManager.ServerClientId);
        infoText.text = "Players: " + players + "   Ping: " + rtt + " ms";
    }
}
```

What each piece does:
- **`PlayerHands.Local`** is your own hands, from step 7.5. It's null before your player spawns, hence the check.
- **The hint** reads the two properties PlayerHands keeps up to date.
- **`Time.unscaledTime`** keeps counting even if the game is paused or slowed, so the info timer never stalls.
- **`FindObjectsByType<PlayerMotor>`** finds every player copy on this machine. Every machine has one per player, so
  the count is right everywhere. It's a scene search, so it only runs twice a second.
- **`IsListening`** is true once a session is running.
- **`GetCurrentRtt(ServerClientId)`** is the round-trip time to the host in milliseconds: your ping. The host has no
  ping to itself, so it shows "(hosting)" instead.

**Hook it up:** select `UI/HUD` (it's inactive, but you can still edit it), Add Component > HudUI, and drag in
`HintText` and `InfoText`. Save the scene.

**Try it:**
1. Host in the main window: the top left reads "Players: 1 (hosting)".
2. Join from Player 2: the host's line becomes "Players: 2 (hosting)", and the client's reads
   "Players: 2   Ping: ... ms".
3. Look at a box: "E: pick up". Pick it up: "Click: throw". Throw it, and the hint clears.

---

## 8. Carrying another player (the pattern)

Nothing new in networking terms. It's the same rules combined:

- **State on the target:** a NetworkVariable holding who's carrying it (for example two client ids). The host writes
  it, after checking that both carriers have their arms on the target.
- **The target's own machine** sees that state, stops reading input, and each frame moves its body to the midpoint of
  its carriers' hands (`TeleportOwner`-style, or by skipping `Move` while carried).
- **Every machine draws the target at the carriers' midpoint as that machine sees them**, instead of trusting the
  target's own synced position. With plain interpolation alone, a carried player trails about two pings behind the hands
  on the carriers' screens, because the delays stack: carrier to target, then target back to carrier. Drawing it
  locally at the hands removes the stack.
- **A throw** clears the state, and the host calls `ServerPush` on the target with the throw velocity.

It's the natural next exercise once sections 3 to 7 work.

---

## 9. Testing under real network conditions

Two windows on one PC have almost no lag, which hides most bugs. The NetworkManager has a **Network Simulator**:
1. Set its preset to something like home broadband (around 50 to 100 ms), then play with two windows.
2. Watch for:
   - **your own movement** should still feel instant, because it's local;
   - **other players** move smoothly but slightly behind, which is interpolation doing its job;
   - **pick-ups** take a moment to "take", because the request goes to the host and back;
   - **pushes** arrive late on the client, because owners apply them.
3. Add some packet loss and check nothing gets stuck, for example a box that never comes back after a throw.

The **Network Profiler** (Window > Multiplayer > Multiplayer Tools) shows how many bytes each object sends.

### Interpolation settings worth knowing (on each NetworkTransform)

| Setting | What it does |
| --- | --- |
| Interpolate | smooths between received updates. Keep it on for anything other players watch |
| Thresholds | the smallest change worth sending. Raise them for big, slow things |
| Use Half Float Precision | halves the bytes for positions and rotations |
| Sync axes | only send what changes. Players need position and yaw only |

The **tick rate** (60 on this project) is how often updates go out. Every player in a session shares one tick rate,
and your own movement and camera run every frame regardless, so a 120 fps player still gets 120 smooth frames.

---

## 10. Going over the internet

Unity Transport on 127.0.0.1 works on one PC, and on a LAN with the host's `192.168.x.x` address. Across the internet,
home routers block direct connections, so P2P games go through a **relay**, a middleman server both sides can reach:
- **Unity Relay**, through the **Multiplayer Services** package: you get a short **join code** to share instead of an
  IP address. Its "sessions" API also covers lobbies (a list of open games).
- **Steam**, through a Steamworks transport: Steam lobbies, invites and Steam's relay.

Either way it's a **transport swap** plus a lobby or join step in the menu. Your player, box and RPC code doesn't
change. That's why the menu is its own script: section 3 is the only part that changes.

---

## 11. Mistakes everyone makes once

| Symptom | Cause |
| --- | --- |
| Clicking a button does nothing | the cursor is locked, there's no EventSystem, something is covering the button, or a slot is empty |
| The other player never moves on my screen | the NetworkTransform is on Server authority, or missing |
| Both windows control the same player | a missing `if (!IsOwner) return;` |
| A spawned object appears only on the host | its prefab isn't in the Network Prefabs List |
| "Not spawned" or IsOwner errors | read in Awake or Start; use OnNetworkSpawn |
| A teleport snaps back | the CharacterController was on; turn it off around the move |
| A box jitters or flies off | two machines simulate it, because it isn't kinematic on the non-owner |
| A hit on another player does nothing | the host doesn't move them; call `ServerPush` |
| A method fires twice per click | the listener was added twice; add in OnEnable, remove in OnDisable |
| `?.` throws on a destroyed object | Unity overrides `== null` for destroyed objects, and `?.` skips that check. Always use `== null` |
| A late joiner sees things in the wrong state | that state lived in an RPC instead of a NetworkVariable |

---

## 12. Exercises, in order

1. **Sprint stamina:** owner-side only. Does anything need syncing? (Hint: does anyone else need to know?)
2. **A launch pad:** a trigger the *host* watches, using `Physics.OverlapBox` (remote players have colliders, section
   6), that calls `ServerPush` upward.
3. **A flour bag:** a Grabbable that, on its first hit, sends `[Rpc(SendTo.Everyone)]` for a puff and hides itself.
   Which part is state, and which is a moment?
4. **Greasy floor:** a host-decided effect sent to the owner, which makes `PlayerMotor` blend toward its input slowly
   instead of instantly.
5. **Player names:** a `NetworkVariable<FixedString32Bytes>` the **owner** writes (look up NetworkVariable write
   permissions), shown on a World Space canvas above each player.
6. **Two-person carry:** section 8, built for real. Test it at 100 ms in the Network Simulator, with and without
   drawing the target at the carriers' hands, and see the difference.
