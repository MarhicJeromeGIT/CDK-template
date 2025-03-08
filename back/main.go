package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
)

var (
	counter int
	mu      sync.Mutex
)

// curl -X POST http://localhost:8080/api/count
func countHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	mu.Lock()
	counter++
	currentCount := counter
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"count": currentCount})
}

func main() {
	http.HandleFunc("/api/count", countHandler)

	log.Println("Server started on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
