{
  description = "Node 25 devShell";

  inputs.nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";

  outputs = { self, nixpkgs }:
  let
    system = "aarch64-darwin";
    pkgs = import nixpkgs { inherit system; };
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [
        nodejs_25
        pnpm
        typescript-language-server
        vscode-langservers-extracted
      ];

      shellHook = ''
        echo "Node: $(node -v)"
      '';
    };
  };
}
