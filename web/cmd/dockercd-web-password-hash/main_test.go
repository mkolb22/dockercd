package main

import (
	"bytes"
	"errors"
	"os"
	"testing"

	"golang.org/x/term"
)

func TestWaitForPasswordRestoresTerminalOnInterrupt(t *testing.T) {
	interrupts := make(chan os.Signal, 1)
	interrupts <- os.Interrupt
	release := make(chan struct{})
	restored := false
	_, err := waitForPassword(7, new(term.State), func(int) ([]byte, error) {
		<-release
		return nil, errors.New("interrupted reader")
	}, func(descriptor int, state *term.State) error {
		if descriptor != 7 || state == nil {
			t.Fatalf("unexpected restore arguments: %d %#v", descriptor, state)
		}
		restored = true
		return nil
	}, interrupts)
	close(release)
	if err == nil || !restored {
		t.Fatalf("interrupt result error=%v restored=%t", err, restored)
	}
}

func TestClearZerosPasswordBuffer(t *testing.T) {
	value := []byte("secret")
	clear(value)
	for _, item := range value {
		if item != 0 {
			t.Fatal("password buffer was not cleared")
		}
	}
}

func TestReadRawPasswordHandlesEditingAndInterrupt(t *testing.T) {
	value, err := readRawPasswordFrom(bytes.NewBufferString("ab\bcd\r"))
	if err != nil || string(value) != "acd" {
		t.Fatalf("edited password value=%q error=%v", value, err)
	}
	clear(value)
	value, err = readRawPasswordFrom(bytes.NewBuffer(append([]byte("é"), '\b', 'x', '\n')))
	if err != nil || string(value) != "x" {
		t.Fatalf("UTF-8 edited password value=%q error=%v", value, err)
	}
	clear(value)
	if _, err := readRawPasswordFrom(bytes.NewBuffer([]byte{3})); !errors.Is(err, errPasswordInterrupted) {
		t.Fatalf("Ctrl-C error=%v", err)
	}
}

func TestReadRawPasswordRejectsInvalidUTF8AndOverlongInput(t *testing.T) {
	if _, err := readRawPasswordFrom(bytes.NewBuffer([]byte{0xc3, '\n'})); err == nil {
		t.Fatal("invalid UTF-8 password was accepted")
	}
	input := append(bytes.Repeat([]byte{'x'}, maxPasswordInputBytes+1), '\n')
	if _, err := readRawPasswordFrom(bytes.NewReader(input)); err == nil {
		t.Fatal("overlong password was accepted")
	}
}

func TestRunRejectsNoninteractiveInput(t *testing.T) {
	if term.IsTerminal(int(os.Stdin.Fd())) {
		t.Skip("test runner has an interactive terminal")
	}
	if err := run(); err == nil {
		t.Fatal("noninteractive password input was accepted")
	}
}
