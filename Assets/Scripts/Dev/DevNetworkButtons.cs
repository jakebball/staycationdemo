using Unity.Netcode;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Developer-only Host and Client buttons in the top-right corner, for quick testing before the real menu is hooked
/// up. They hide once a session is running and come back when it stops. Lives on DevCanvas; delete DevCanvas when you
/// no longer want it.
/// </summary>
public class DevNetworkButtons : MonoBehaviour
{
    [SerializeField] private GameObject buttonsRoot;
    [SerializeField] private Button hostButton;
    [SerializeField] private Button clientButton;

    private void OnEnable()
    {
        hostButton.onClick.AddListener(OnHostClicked);
        clientButton.onClick.AddListener(OnClientClicked);
    }

    private void OnDisable()
    {
        hostButton.onClick.RemoveListener(OnHostClicked);
        clientButton.onClick.RemoveListener(OnClientClicked);
    }

    private void OnHostClicked()
    {
        NetworkManager.Singleton.StartHost();
    }

    private void OnClientClicked()
    {
        NetworkManager.Singleton.StartClient();
    }

    // Show the buttons only while no session is running on this machine.
    private void Update()
    {
        NetworkManager manager = NetworkManager.Singleton;
        bool isRunning = manager != null && (manager.IsServer || manager.IsClient);
        if (buttonsRoot.activeSelf == isRunning)
        {
            buttonsRoot.SetActive(!isRunning);
        }
    }
}
