{
  "targets": [
    {
      "target_name": "overlay_window",
      "msbuild_toolset": "v143",
      "sources": [
        "src/main/shared/lib/overlay/lib/addon.c",
        "src/main/shared/lib/overlay/lib/napi_helpers.c"
      ],
      "include_dirs": [
        "src/main/shared/lib/overlay/lib"
      ],
      "conditions": [
        ["OS=='win'", {
          "defines": ["WIN32_LEAN_AND_MEAN"],
          "link_settings": {
            "libraries": ["oleacc.lib"]
          },
          "sources": ["src/main/shared/lib/overlay/lib/windows.c"]
        }],
        ["OS=='linux'", {
          "defines": ["_GNU_SOURCE"],
          "link_settings": {
            "libraries": ["-lxcb", "-lpthread"]
          },
          "cflags": ["-std=c99", "-pedantic", "-Wall", "-pthread"],
          "sources": ["src/main/shared/lib/overlay/lib/x11.c"]
        }],
        ["OS=='mac'", {
          "link_settings": {
            "libraries": [
              "-lpthread",
              "-framework AppKit",
              "-framework ApplicationServices"
            ]
          },
          "xcode_settings": {
            "OTHER_CFLAGS": ["-fobjc-arc"]
          },
          "cflags": ["-std=c99", "-pedantic", "-Wall", "-pthread"],
          "sources": [
            "src/main/shared/lib/overlay/lib/mac.mm",
            "src/main/shared/lib/overlay/lib/mac/OWFullscreenObserver.mm"
          ]
        }]
      ]
    }
  ]
}