{
  description = "Node 24 devShell";

  inputs.nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";

  outputs = { self, nixpkgs }:
  let
    forAllSystems = f: nixpkgs.lib.genAttrs [
      "aarch64-darwin"
      "x86_64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ] (system: f (import nixpkgs { inherit system; }));
  in {
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_24
          pnpm
          gh
          typescript-language-server
          vscode-langservers-extracted
        ];

        shellHook = ''
          echo "Node: $(node -v)"
        '';
      };
    });
  };
}
