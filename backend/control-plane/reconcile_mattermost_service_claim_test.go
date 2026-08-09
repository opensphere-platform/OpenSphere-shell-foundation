package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMattermostSessionUsesOfficialTeamBotAndTokenEndpoints(t *testing.T) {
	membershipCreated := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer admin-token-value-1234567890" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch request.Method + " " + request.URL.Path {
		case "GET /api/v4/teams/name/platform":
			http.NotFound(w, request)
		case "POST /api/v4/teams":
			var payload map[string]interface{}
			_ = json.NewDecoder(request.Body).Decode(&payload)
			if payload["name"] != "platform" || payload["type"] != "O" {
				t.Errorf("team payload=%#v", payload)
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"id": "team-id", "name": "platform"})
		case "POST /api/v4/bots":
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"user_id": "bot-user-id", "username": "release_bot"})
		case "POST /api/v4/users/bot-user-id/tokens":
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]interface{}{"id": "token-id", "token": "bot-token"})
		case "GET /api/v4/teams/team-id/members/bot-user-id":
			if membershipCreated {
				json.NewEncoder(w).Encode(map[string]interface{}{"team_id": "team-id", "user_id": "bot-user-id"})
			} else {
				http.NotFound(w, request)
			}
		case "POST /api/v4/teams/team-id/members":
			membershipCreated = true
			w.WriteHeader(http.StatusCreated)
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	session := &mattermostSession{baseURL: server.URL, token: "admin-token-value-1234567890", client: server.Client()}
	if _, exists, err := session.getTeam(context.Background(), "platform"); err != nil || exists {
		t.Fatalf("team exists=%v err=%v", exists, err)
	}
	team, err := session.createTeam(context.Background(), "platform", "Platform", "O")
	if err != nil || team["id"] != "team-id" {
		t.Fatalf("team=%#v err=%v", team, err)
	}
	bot, err := session.createBot(context.Background(), "release_bot", "Release bot", "managed")
	if err != nil || bot["user_id"] != "bot-user-id" {
		t.Fatalf("bot=%#v err=%v", bot, err)
	}
	token, tokenID, err := session.createBotToken(context.Background(), "bot-user-id", "managed")
	if err != nil || token != "bot-token" || tokenID != "token-id" {
		t.Fatalf("token=%q id=%q err=%v", token, tokenID, err)
	}
	if err := session.ensureTeamMember(context.Background(), "team-id", "bot-user-id"); err != nil || !membershipCreated {
		t.Fatalf("membership created=%v err=%v", membershipCreated, err)
	}
}

func TestMattermostCatalogUsesManagedProductDriver(t *testing.T) {
	contract, _ := serviceContract("mattermost")
	for requestType, mode := range map[string]string{"Workspace": "managed", "Access": "managed"} {
		if contract.requestMode(requestType) != mode || !contract.requestReady(requestType) {
			t.Errorf("Mattermost %s must be %s", requestType, mode)
		}
	}
}
